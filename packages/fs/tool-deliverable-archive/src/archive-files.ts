/** Stream workspace files into the attachment store as archived deliverables. */
import { basename } from 'node:path'
import type { AttachmentStore, FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { FsError, type FileSystem, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { ArchivedFile } from './types.ts'

/** One path the model asked to archive, with optional display description. */
export interface ArchiveFileRequest {
  readonly path: string
  readonly description?: string
}

/** Chunk size for workspace → attachment streaming. */
const STREAM_CHUNK_BYTES = 64 * 1024

/**
 * Stream one regular file as bounded byte windows for attachment commit.
 * @param fs - composed Session filesystem.
 * @param target - resolved regular-file target.
 * @param signal - tool cancellation.
 * @returns ordered exact file bytes.
 */
async function* streamFileBytes(
  fs: FileSystem,
  target: FsTarget,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  let offset = 0
  for (;;) {
    signal.throwIfAborted()
    const chunk = await fs.readByteRange(target, { offset, length: STREAM_CHUNK_BYTES }, signal)
    if (chunk.byteLength === 0) return
    yield chunk
    offset += chunk.byteLength
    if (chunk.byteLength < STREAM_CHUNK_BYTES) return
  }
}

/**
 * Copy existing Session-filesystem files into the attachment store.
 * @param fs - composed Session filesystem.
 * @param attachments - mounted attachment store.
 * @param cwd - Session working directory for relative paths.
 * @param requests - files to archive.
 * @param signal - cancellation.
 * @returns archived file declarations with attachment references.
 */
export async function archiveWorkspaceFiles(
  fs: FileSystem,
  attachments: AttachmentStore,
  cwd: string,
  requests: readonly ArchiveFileRequest[],
  signal: AbortSignal,
): Promise<ArchivedFile[]> {
  const options = { cwd, signal }
  const files: ArchivedFile[] = []
  for (const file of requests) {
    if (file.path.trim().length === 0) throw new Error('archive requires a non-empty file path')
    const entry = await fs.lstat(file.path, { cwd }, signal)
    if (entry !== undefined && entry.type !== 'file') {
      throw new Error(`Cannot archive ${file.path}: not a regular file`)
    }
    const target = await fs.resolve(file.path, options)
    const info = await fs.stat(target, signal)
    if (info === undefined) {
      throw new FsError(
        `Cannot archive ${file.path}: file not found. Check the path, create the file if needed, and retry.`,
        'FS_NOT_FOUND',
      )
    }
    if (info.type !== 'file') throw new Error(`Cannot archive ${file.path}: not a regular file`)
    const attachment: FileAttachmentRef = await attachments.saveFileStream({
      data: streamFileBytes(fs, target, signal),
      name: basename(file.path),
      signal,
    })
    files.push({
      path: file.path,
      ...file.description === undefined ? {} : { description: file.description },
      attachment,
    })
  }
  signal.throwIfAborted()
  return files
}
