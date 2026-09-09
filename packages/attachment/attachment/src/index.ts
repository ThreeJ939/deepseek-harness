/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */

import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentError } from './error.ts'
import type {
  DocumentAttachmentLimits,
  DocumentAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveDocumentAttachment,
  SaveImageAttachment,
  StoredDocumentAttachment,
  StoredImageAttachment,
} from './types.ts'

export { AttachmentId, ImageVariantId } from './brand.ts'
export { AttachmentError, isDocumentAdmissionError, isImageAdmissionError } from './error.ts'
export type { AttachmentErrorCode, DocumentAdmissionErrorCode, ImageAdmissionErrorCode } from './error.ts'
export { admitEncodedDocuments, admitEncodedImages, admitPromptContent, admittedPartsToContentBlocks } from './admission.ts'
export type { AdmitPromptContentOptions, DocumentTextExtractor } from './admission.ts'
export { requestImageDimensions } from './request-projection.ts'
export type {
  AttachmentId as AttachmentIdType,
  AdmittedPromptContentPart,
  DocumentAttachmentLimits,
  DocumentAttachmentRef,
  DocumentMediaType,
  EncodedDocumentAttachment,
  EncodedImageAttachment,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  ImageMediaType,
  PromptContentPart,
  RequestImageAttachment,
  SaveDocumentAttachment,
  SaveImageAttachment,
  StoredDocumentAttachment,
  StoredImageAttachment,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: AttachmentStore
  }
}

/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export abstract class AttachmentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits

  /**
   * Deployment-resolved document policy. Absent when this backend does not
   * accept document uploads.
   */
  readonly documentLimits: DocumentAttachmentLimits | undefined = undefined

  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>

  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  protected validateImageBatch(inputs: readonly SaveImageAttachment[]): void {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
      }
    }
  }

  /**
   * Validate and durably commit one ordered image batch.
   * @param inputs - encoded images in owning-message order.
   * @returns durable normalized attachment references in the same order after every member succeeds.
   */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    this.validateImageBatch(inputs)
    for (const input of inputs) await this.validateImage(input)

    const refs: ImageAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }

  /**
   * Validate and durably commit one image before its owning session event is appended.
   * The returned reference describes the persisted normalized image. When
   * normalization reduces the raster, its `originalDimensions` records the
   * orientation-applied input dimensions.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns the durable content-addressed normalized image reference.
   */
  abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

  /**
   * Read one image and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and normalized attachment reference.
   * @throws the signal reason when aborted, or a storage error when verification fails.
   */
  abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

  /**
   * Locate the provider-owned normalized object in the harness host filesystem.
   * @param ref - durable normalized attachment reference.
   * @returns an absolute host path, or undefined when this backend is not host-file-backed.
   * @throws an AttachmentError when the durable reference is invalid.
   */
  imageHostPath(ref: ImageAttachmentRef): string | undefined {
    void ref
    return undefined
  }

  /**
   * Generate or read one deterministic model-request version from the stored normalized image.
   * @param ref - durable provider-independent normalized attachment reference.
   * @param policy - exact route pixel budget and encoded-byte target; a target no ladder quality meets yields the smallest ladder output.
   * @param signal - optional cancellation.
   * @returns request bytes and the cache/upload identity covering every transform input.
   */
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    void ref
    void policy
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot derive model-request images.',
      'ATTACHMENT_PROJECTION_UNSUPPORTED',
    ))
  }

  /**
   * Validate one ordered document batch before committing any member.
   * @param inputs - encoded documents in their owning message order.
   */
  protected validateDocumentBatch(inputs: readonly SaveDocumentAttachment[]): void {
    const limits = this.documentLimits
    if (limits === undefined) {
      throw new AttachmentError(
        'The mounted attachment provider cannot store documents.',
        'DOCUMENT_STORE_UNSUPPORTED',
      )
    }
    const { maxDocumentsPerMessage, maxMessageDocumentBytes, mediaTypes } = limits
    if (inputs.length > maxDocumentsPerMessage) {
      throw new AttachmentError('Document batch exceeds the configured document-count limit.', 'TOO_MANY_DOCUMENTS')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageDocumentBytes) {
      throw new AttachmentError('Document batch exceeds the configured aggregate document-byte limit.', 'DOCUMENTS_TOO_LARGE')
    }
    for (const input of inputs) {
      if (input.data.byteLength > limits.maxDocumentBytes) {
        throw new AttachmentError('Document exceeds the configured byte limit.', 'DOCUMENT_TOO_LARGE')
      }
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(
          `Document type ${input.mediaType} is not accepted by this deployment.`,
          'UNSUPPORTED_DOCUMENT_TYPE',
        )
      }
    }
  }

  /**
   * Validate and durably commit one ordered document batch.
   * @param inputs - encoded documents in owning-message order.
   * @returns durable document references in the same order after every member succeeds.
   */
  async saveDocuments(inputs: readonly SaveDocumentAttachment[]): Promise<readonly DocumentAttachmentRef[]> {
    this.validateDocumentBatch(inputs)
    const refs: DocumentAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveDocument(input))
    return refs
  }

  /**
   * Validate and durably commit one document before its owning session event is appended.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns the durable content-addressed document reference.
   */
  saveDocument(input: SaveDocumentAttachment): Promise<DocumentAttachmentRef> {
    void input
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot store documents.',
      'DOCUMENT_STORE_UNSUPPORTED',
    ))
  }

  /**
   * Read one document and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and document reference.
   */
  readDocument(ref: DocumentAttachmentRef, signal?: AbortSignal): Promise<StoredDocumentAttachment> {
    signal?.throwIfAborted()
    void ref
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot store documents.',
      'DOCUMENT_STORE_UNSUPPORTED',
    ))
  }

}

export default AttachmentStore
