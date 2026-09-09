/**
 * Plain-text extraction for admitted document attachments.
 * @module @deepseek-ai/dsh-attachment-document/extractor
 */

import { AttachmentError, type DocumentMediaType } from '@deepseek-ai/dsh-attachment'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

/** Default character budget when callers omit an explicit limit. */
export const DEFAULT_MAX_EXTRACTED_CHARS = 50_000

/** UTF-8 text media types decoded without a binary parser. */
const TEXT_MEDIA_TYPES = new Set<DocumentMediaType>([
  'text/plain',
  'application/json',
  'text/markdown',
  'text/csv',
  'text/x-java-source',
  'application/sql',
])

/**
 * Truncate extracted text to the configured character budget.
 * @param text - full extracted text.
 * @param maxChars - inclusive Unicode code-point budget.
 * @returns truncated text, or the original when within budget.
 */
function truncate(text: string, maxChars: number): string {
  if (maxChars < 1) return ''
  const points = Array.from(text)
  if (points.length <= maxChars) return text
  return `${points.slice(0, maxChars).join('')}…`
}

/**
 * Decode UTF-8 document bytes, rejecting empty payloads.
 * @param data - raw document bytes.
 * @returns decoded text.
 */
function decodeUtf8(data: Uint8Array): string {
  if (data.byteLength === 0) {
    throw new AttachmentError('Document is empty.', 'INVALID_DOCUMENT')
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/^\uFEFF/, '')
}

/**
 * Extract plain text from a PDF buffer.
 * @param data - complete PDF bytes.
 * @returns concatenated page text.
 */
async function extractPdf(data: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data })
  try {
    const result = await parser.getText()
    return result.text.trim()
  } finally {
    await parser.destroy().catch(() => {})
  }
}

/**
 * Extract plain text from a DOCX buffer.
 * @param data - complete DOCX bytes.
 * @returns document body text.
 */
async function extractDocx(data: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) })
  return result.value.trim()
}

/**
 * Extract model-visible plain text from one admitted document.
 * Unsupported binary formats that cannot be parsed raise
 * {@link AttachmentError} with `DOCUMENT_EXTRACTION_FAILED`.
 * @param data - complete document bytes.
 * @param mediaType - declared document media type.
 * @param maxChars - maximum retained Unicode code points (default 50_000).
 * @returns truncated plain text suitable for prompt injection.
 */
export async function extractText(
  data: Uint8Array,
  mediaType: DocumentMediaType,
  maxChars: number = DEFAULT_MAX_EXTRACTED_CHARS,
): Promise<string> {
  try {
    let text: string
    if (TEXT_MEDIA_TYPES.has(mediaType)) {
      text = decodeUtf8(data)
    } else if (mediaType === 'application/pdf') {
      text = await extractPdf(data)
    } else if (
      mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || mediaType === 'application/msword'
    ) {
      // mammoth supports DOCX; legacy DOC bytes typically fail and surface below.
      text = await extractDocx(data)
    } else {
      throw new AttachmentError(
        `Document type ${mediaType} has no text extractor in this deployment.`,
        'DOCUMENT_EXTRACTION_FAILED',
      )
    }
    if (text.trim() === '') {
      throw new AttachmentError('Document text extraction produced no content.', 'DOCUMENT_EXTRACTION_FAILED')
    }
    return truncate(text, maxChars)
  } catch (error: unknown) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError(
      'Document text extraction failed.',
      'DOCUMENT_EXTRACTION_FAILED',
      { cause: error },
    )
  }
}
