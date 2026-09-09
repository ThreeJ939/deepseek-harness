/** Durable attachment vocabulary. @module @deepseek-ai/dsh-attachment/types */

import type { AttachmentId, ImageVariantId } from './brand.ts'

export type { AttachmentId } from './brand.ts'

/** Raster image formats accepted by the version-one attachment path. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/bmp'

/**
 * Document formats accepted by the document attachment path. Binary office
 * formats beyond PDF/DOCX may be stored; text extraction coverage is owned by
 * the document extractor package.
 */
export type DocumentMediaType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/msword'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.ms-excel'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  | 'application/vnd.ms-powerpoint'
  | 'text/plain'
  | 'application/json'
  | 'text/markdown'
  | 'text/csv'
  | 'text/x-java-source'
  | 'application/sql'
  | 'application/epub+zip'

/** Durable, serializable reference to one immutable normalized image. */
export interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
  /**
   * Input dimensions after applying EXIF orientation and before normalization
   * scaling. Present only when normalization reduced the image.
   */
  originalDimensions?: {
    width: number
    height: number
  }
}

/** Durable, serializable reference to one immutable uploaded document. */
export interface DocumentAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type declared at admission and recorded on the object. */
  mediaType: DocumentMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Optional display name stripped of local path information. */
  name?: string
}

/** Deployment-resolved limits used by upload admission and request buffering. */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  /** Maximum intrinsic width and maximum intrinsic height in pixels for one image. */
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}

/** Deployment-resolved limits for document upload admission. */
export interface DocumentAttachmentLimits {
  maxDocumentBytes: number
  maxDocumentsPerMessage: number
  maxMessageDocumentBytes: number
  /** Maximum characters retained from one document after text extraction. */
  maxExtractedCharsPerDocument: number
  mediaTypes: readonly DocumentMediaType[]
}

/** Base64-encoded image upload accompanying one wire request. */
export interface EncodedImageAttachment {
  /** Declared media type, verified against the decoded bytes during admission. */
  mediaType: ImageMediaType
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}

/** Base64-encoded document upload accompanying one wire request. */
export interface EncodedDocumentAttachment {
  /** Declared media type checked during admission. */
  mediaType: DocumentMediaType
  /** Canonical base64 encoding of the document bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}

/**
 * Browser-submitted prompt content accepted by Host prompt endpoints; the
 * accepting Host promotes image and document parts to durable references through
 * `admitPromptContent` before any message is created, so a wire caller can
 * never cite an attachment it did not upload.
 */
export type PromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
    readonly type: 'image'
    readonly mediaType: ImageMediaType
    readonly data: string
    readonly name?: string
  }
  | {
    readonly type: 'document'
    readonly mediaType: DocumentMediaType
    readonly data: string
    readonly name?: string
  }

/**
 * Host-admitted prompt content with each uploaded image or document replaced by
 * its durable reference. Document parts retain extracted text for model injection.
 */
export type AdmittedPromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
  | {
    readonly type: 'document'
    readonly attachment: DocumentAttachmentRef
    readonly extractedText: string
  }

/** Request to validate and durably commit one image. */
export interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}

/** Request to validate and durably commit one document. */
export interface SaveDocumentAttachment {
  data: Uint8Array
  /** Caller-declared media type checked during admission. */
  mediaType: DocumentMediaType
  /** Optional browser display name; it is never interpreted as a path. */
  name?: string
}

/** Stored image bytes returned after reference and digest verification. */
export interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}

/** Stored document bytes returned after reference and digest verification. */
export interface StoredDocumentAttachment {
  ref: DocumentAttachmentRef
  data: Uint8Array
}

/** Deterministic request-image policy selected by one exact model route. */
export interface ImageRequestPolicy {
  /** Maximum width multiplied by height after aspect-preserving projection. */
  maxPixels: number
  /** Encoded-byte target before base64 expansion or Files API upload; the smallest quality-ladder output is kept when no quality fits. */
  maxBytes: number
}

/** Cached request version derived from one provider-independent normalized attachment. */
export interface RequestImageAttachment {
  /** Cache and upload-index key over the attachment id, policy, and fixed encoder parameters. */
  variantId: ImageVariantId
  /** Durable normalized attachment from which this request version was derived. */
  attachment: ImageAttachmentRef
  /** Encoded request bytes. */
  data: Uint8Array
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  /** Provider-compatible sample depth proven after request encoding. */
  depth: 'uchar'
  /** Provider-compatible color space proven after request encoding. */
  space: 'srgb'
  /** Whether the encoded request version retains an alpha channel. */
  hasAlpha: boolean
}
