/** Wire-form admission of base64-encoded image and document uploads. @module @deepseek-ai/dsh-attachment/admission */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import type { AttachmentStore } from './index.ts'
import type {
  AdmittedPromptContentPart,
  DocumentAttachmentRef,
  DocumentMediaType,
  EncodedDocumentAttachment,
  EncodedImageAttachment,
  ImageAttachmentRef,
  PromptContentPart,
  SaveDocumentAttachment,
  SaveImageAttachment,
} from './types.ts'

/** Decode one upload payload while rejecting non-canonical base64 forms. */
function decodeBase64(data: string, invalidCode: 'INVALID_IMAGE_BASE64' | 'INVALID_DOCUMENT_BASE64'): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    throw new AttachmentError(
      invalidCode === 'INVALID_IMAGE_BASE64'
        ? 'Image upload is not canonical base64.'
        : 'Document upload is not canonical base64.',
      invalidCode,
    )
  }
  return new Uint8Array(decoded)
}

/** Store input for one decoded image upload. */
function saveImageInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeBase64(image.data, 'INVALID_IMAGE_BASE64'),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/** Store input for one decoded document upload. */
function saveDocumentInput(document: EncodedDocumentAttachment): SaveDocumentAttachment {
  return {
    data: decodeBase64(document.data, 'INVALID_DOCUMENT_BASE64'),
    mediaType: document.mediaType,
    ...document.name === undefined ? {} : { name: document.name },
  }
}

/**
 * Extract plain text from one admitted document. Callers that accept documents
 * must supply an extractor; image-only prompts need none.
 */
export type DocumentTextExtractor = (
  data: Uint8Array,
  mediaType: DocumentMediaType,
  maxChars: number,
) => Promise<string>

/** Options for admitting mixed prompt content. */
export interface AdmitPromptContentOptions {
  /**
   * Extract model-visible text from stored document bytes. Required when the
   * prompt contains at least one document part.
   */
  readonly extractDocumentText?: DocumentTextExtractor
}

/**
 * Admit one wire image batch: enforce canonical base64 on every member, then
 * delegate batch admission — count and aggregate-byte limits, media-type and
 * per-image validation, ordered commit — to {@link AttachmentStore.saveImages}.
 * The shared entry for every RPC endpoint accepting browser uploads.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param images - base64-encoded uploads in caller order.
 * @returns durable references in the same order as `images`.
 * @throws AttachmentError on a non-canonical payload or a refused batch.
 */
export async function admitEncodedImages(
  attachments: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(saveImageInput))
}

/**
 * Admit one wire document batch: decode, persist, and extract model-visible text.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param documents - base64-encoded uploads in caller order.
 * @param extractDocumentText - extractor that turns stored bytes into plain text.
 * @returns durable references beside extracted text, in the same order as `documents`.
 */
export async function admitEncodedDocuments(
  attachments: AttachmentStore,
  documents: readonly EncodedDocumentAttachment[],
  extractDocumentText: DocumentTextExtractor,
): Promise<readonly { attachment: DocumentAttachmentRef; extractedText: string }[]> {
  const inputs = documents.map(saveDocumentInput)
  const refs = await attachments.saveDocuments(inputs)
  const maxChars = attachments.documentLimits?.maxExtractedCharsPerDocument ?? 50_000
  const admitted: { attachment: DocumentAttachmentRef; extractedText: string }[] = []
  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i] as DocumentAttachmentRef
    const input = inputs[i] as SaveDocumentAttachment
    try {
      const extractedText = await extractDocumentText(input.data, input.mediaType, maxChars)
      admitted.push({ attachment: ref, extractedText })
    } catch (error: unknown) {
      if (error instanceof AttachmentError) throw error
      throw new AttachmentError(
        'Document text extraction failed.',
        'DOCUMENT_EXTRACTION_FAILED',
        { cause: error },
      )
    }
  }
  return admitted
}

/**
 * Admit one browser prompt and replace each uploaded image or document with its
 * durable reference. Text-only prompts do not access the attachment store.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param content - browser prompt parts in message order.
 * @param options - document text extractor when document parts are present.
 * @returns admitted prompt parts in the same order as `content`.
 * @throws AttachmentError when an image or document batch is refused.
 */
export async function admitPromptContent(
  attachments: AttachmentStore,
  content: readonly PromptContentPart[],
  options?: AdmitPromptContentOptions,
): Promise<AdmittedPromptContentPart[]> {
  if (content.every(part => part.type === 'text')) {
    return content.map(part => ({ type: 'text', text: part.text }))
  }
  const images = content.filter(part => part.type === 'image')
  const documents = content.filter(part => part.type === 'document')
  const imageRefs = images.length === 0
    ? []
    : await admitEncodedImages(attachments, images)
  let documentAdmitted: readonly { attachment: DocumentAttachmentRef; extractedText: string }[] = []
  if (documents.length > 0) {
    if (options?.extractDocumentText === undefined) {
      throw new AttachmentError(
        'Document uploads require a text extractor.',
        'DOCUMENT_EXTRACTION_FAILED',
      )
    }
    documentAdmitted = await admitEncodedDocuments(
      attachments,
      documents,
      options.extractDocumentText,
    )
  }
  let nextImage = 0
  let nextDocument = 0
  return content.map((part): AdmittedPromptContentPart => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') {
      return { type: 'image', attachment: imageRefs[nextImage++] as ImageAttachmentRef }
    }
    const admitted = documentAdmitted[nextDocument++] as {
      attachment: DocumentAttachmentRef
      extractedText: string
    }
    return {
      type: 'document',
      attachment: admitted.attachment,
      extractedText: admitted.extractedText,
    }
  })
}

/**
 * Convert admitted prompt parts into LLM content blocks. Document parts keep
 * their durable reference and extracted text as a `document` block; adapters
 * call {@link expandDocumentBlocks} to inline the text before sending the request.
 * @param parts - host-admitted prompt parts in message order.
 * @returns content blocks suitable for `createUserMessage`.
 */
export function admittedPartsToContentBlocks(
  parts: readonly AdmittedPromptContentPart[],
): Array<
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
  | { readonly type: 'document'; readonly attachment: DocumentAttachmentRef; readonly extractedText: string }
> {
  return parts.map((part) => {
    if (part.type === 'text') return { type: 'text' as const, text: part.text }
    if (part.type === 'image') return { type: 'image' as const, attachment: part.attachment }
    return {
      type: 'document' as const,
      attachment: part.attachment,
      extractedText: part.extractedText,
    }
  })
}
