/** Durable archived deliverables produced by the archive_deliverable tool. */
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

/**
 * One workspace file whose bytes were copied into the attachment store.
 * The Session log retains the durable reference; the source path is retained for display.
 */
export interface ArchivedFile {
  /** Original absolute path or path relative to the Session working directory. */
  path: string
  /** Optional description supplied by the model. */
  description?: string
  /** Content-addressed attachment reference for download and replay. */
  attachment: FileAttachmentRef
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Archived filesystem files from a successful archive_deliverable or auto-archive after present. */
    'deliverables/archived': { turn: number; callId: ToolCallId; files: ArchivedFile[] }
  }
}
