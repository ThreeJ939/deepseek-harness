/** Validate archived attachment deliveries and address their download actions. */
import type { ArchivedFile } from '@deepseek-ai/dsh-tool-deliverable-archive/types'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

/** Authenticated GET/HEAD route for downloading an archived attachment. */
export const DELIVERABLE_DOWNLOAD_PATH = '/api/deliverable.download'

const ATTACHMENT_ID = /^sha256:[a-f0-9]{64}$/

/**
 * Validate an attachment reference read from a Session log.
 * @param value - decoded durable attachment.
 * @returns whether the reference carries a digest id, leaf name, and byte length.
 */
export function isFileAttachmentRef(value: unknown): value is FileAttachmentRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const ref = value as Record<string, unknown>
  return typeof ref.attachmentId === 'string' && ATTACHMENT_ID.test(ref.attachmentId)
    && typeof ref.name === 'string' && ref.name.length > 0
    && typeof ref.bytes === 'number' && Number.isSafeInteger(ref.bytes) && ref.bytes >= 0
    && (ref.mediaType === undefined || typeof ref.mediaType === 'string')
}

/**
 * Validate an archived file declaration read from a Session log.
 * @param value - decoded durable data.
 * @returns whether the declaration contains a path, optional description, and attachment.
 */
export function isArchivedFile(value: unknown): value is ArchivedFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { path, description, attachment } = value as Record<string, unknown>
  return typeof path === 'string' && path.trim().length > 0
    && (description === undefined || typeof description === 'string')
    && isFileAttachmentRef(attachment)
}

/**
 * Build authenticated coordinates for an archived file download.
 * @param sessionId - owning Session.
 * @param seq - deliverables/archived event sequence.
 * @param index - original index in the event's files array.
 * @returns same-origin download URL.
 */
export function archivedFileUrl(sessionId: SessionId, seq: number, index: number): string {
  return `${DELIVERABLE_DOWNLOAD_PATH}?${new URLSearchParams({
    sessionId, seq: String(seq), index: String(index),
  })}`
}

/**
 * Validate an archive event before reading its turn or file declarations.
 * @param value - decoded durable event data.
 * @returns whether the event identifies a turn, call, and file list.
 */
export function isArchivedData(value: unknown): value is {
  turn: number
  callId: ToolCallId
  files: unknown[]
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { turn, callId, files } = value as Record<string, unknown>
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 1
    && typeof callId === 'string' && callId.length > 0 && Array.isArray(files)
}

/**
 * Sanitize an attachment leaf name for Content-Disposition.
 * @param name - stored attachment leaf name.
 * @returns a single-line filename safe for a quoted disposition parameter.
 */
export function archivedDownloadFilename(name: string): string {
  const trimmed = name.trim().replace(/[\r\n"]/gu, '_')
  return trimmed.length === 0 ? 'download.bin' : trimmed
}

/**
 * Build a Fetch-safe Content-Disposition for an archived attachment leaf name.
 * Quoted `filename` stays ASCII (Headers require ByteString); `filename*` carries UTF-8.
 * @param name - stored attachment leaf name.
 * @returns a Content-Disposition header value.
 */
export function archivedContentDisposition(name: string): string {
  const filename = archivedDownloadFilename(name)
  const ascii = filename.replace(/[^\u0020-\u007E]/gu, '_').replaceAll('"', '_')
  const fallback = ascii.trim().length === 0 ? 'download.bin' : ascii
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
