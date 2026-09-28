/** Scoped tool that archives workspace files into the attachment store. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool, type PostToolDecision, type ToolExecution, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import { archiveWorkspaceFiles, type ArchiveFileRequest } from './archive-files.ts'
import type { ArchivedFile } from './types.ts'

/** Stable Loader identity. */
export const name = 'tool-deliverable-archive'

/** Per-call archive limit and present auto-archive switch. */
export interface Config {
  /** Maximum number of files in one call or auto-archive batch. */
  maxFiles: number
  /**
   * When true, a successful `present` is archived into the attachment store before
   * the call settles; archive failure blocks the present result.
   */
  autoArchiveAfterPresent: boolean
}

/** Validated archive configuration. */
export const Config: z<Config> = z.object({
  maxFiles: z.number().default(8),
  autoArchiveAfterPresent: z.boolean().default(true),
})

/** Services used by the scoped archive tool. Attachments are gated at execute time. */
export const inject = ['tools', 'fs', 'sessionProjections']

/** Guidance when present success also archives for Web download. */
const AUTO_ARCHIVE_PROMPT = 'When present succeeds, this deployment also archives those files for Web download. '
  + 'Do not call archive_deliverable for the same files unless you need an immutable copy without presenting.'

/**
 * Register archive_deliverable and optional auto-archive after successful present.
 * @param ctx - agent-scoped services.
 * @param config - maximum files and auto-archive switch.
 */
export function apply(ctx: Context, config: Config): void {
  if (!Number.isSafeInteger(config.maxFiles) || config.maxFiles < 1) {
    throw new Error('archive_deliverable requires a positive integer maxFiles')
  }
  const pending = new WeakMap<ToolExecution, { session: Session; turn: number; files: ArchivedFile[] }>()
  ctx.tools.register(defineTool({
    name: 'archive_deliverable',
    description: 'Copy existing files accessible through the Session filesystem into durable attachment storage for long-term download. '
      + 'Successful present calls already archive automatically for Web download when this plugin is mounted with autoArchiveAfterPresent. '
      + 'Call archive_deliverable only when you need an immutable copy without presenting, or for files you did not present. '
      + 'This does not replace present: present declares editable workspace sources; archive_deliverable stores an immutable copy. '
      + 'The files must already exist. Mentioning a path in your reply does not replace this call.',
    parameters: {
      files: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Path of an existing regular file. Relative paths use the Session working directory.' },
            description: { type: 'string', description: 'Brief description for the user.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          turn: { type: 'integer', required: true },
          files: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                description: { type: 'string' },
                attachment: {
                  type: 'object', additionalProperties: false, required: true,
                  properties: {
                    attachmentId: { type: 'string', required: true },
                    name: { type: 'string', required: true },
                    bytes: { type: 'integer', required: true },
                    mediaType: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.files.map(file => `Archived ${file.path} (${file.attachment.bytes} bytes)`).join('\n'),
      }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('archive_deliverable requires an agent Session')
      const boundary = ctx.sessionProjections.stateOf(exec.agent.session, 'turnBoundary')
      if (boundary === undefined || boundary.openTurnStartSeq === null) {
        throw new Error('archive_deliverable requires an open turn')
      }
      if (args.files.length === 0 || args.files.length > config.maxFiles) {
        throw new Error(`archive_deliverable accepts 1 to ${config.maxFiles} files`)
      }
      const cwd = exec.agent.session.header.cwd
      if (cwd === undefined) throw new Error('archive_deliverable requires a workspace')
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error('archive_deliverable requires a mounted attachment store')
      }
      const files = await archiveWorkspaceFiles(ctx.fs, attachments, cwd, args.files, exec.signal)
      pending.set(exec, { session: exec.agent.session, turn: boundary.lastTurn, files })
      return { turn: boundary.lastTurn, files }
    },
  }))

  if (config.autoArchiveAfterPresent) {
    ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
      if (exec.name !== 'present' || result.isError) return next()
      const parsed = presentedFilesFromResult(result)
      if (parsed === undefined) return next()
      if (parsed.files.length > config.maxFiles) {
        return {
          kind: 'block',
          feedback: [{
            type: 'text',
            text: `Auto-archive after present accepts at most ${config.maxFiles} files.`,
          }],
        }
      }
      if (exec.agent === undefined) {
        return {
          kind: 'block',
          feedback: [{ type: 'text', text: 'Auto-archive after present requires an agent Session.' }],
        }
      }
      const cwd = exec.agent.session.header.cwd
      if (cwd === undefined) {
        return {
          kind: 'block',
          feedback: [{ type: 'text', text: 'Auto-archive after present requires a workspace.' }],
        }
      }
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        return {
          kind: 'block',
          feedback: [{
            type: 'text',
            text: 'Auto-archive after present requires a mounted attachment store.',
          }],
        }
      }
      try {
        const files = await archiveWorkspaceFiles(ctx.fs, attachments, cwd, parsed.files, exec.signal)
        pending.set(exec, { session: exec.agent.session, turn: parsed.turn, files })
        return next()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          kind: 'block',
          feedback: [{ type: 'text', text: `Auto-archive after present failed: ${message}` }],
        }
      }
    })
    const prompt = ctx.get('systemPrompt')
    if (prompt !== undefined) {
      prompt.section({
        name: 'tool-deliverable-archive:auto-after-present',
        order: 9050,
        text: AUTO_ARCHIVE_PROMPT,
      })
    }
  }

  ctx.on('tools/result', (exec, result) => {
    const delivery = pending.get(exec)
    pending.delete(exec)
    if (delivery === undefined || result.isError) return
    const { session, turn, files } = delivery
    session.append('deliverables/archived', {
      turn, callId: exec.callId, files,
    })
  })
}

/**
 * Read presented files and turn from a successful present result.
 * @param result - successful present tool result.
 * @returns parsed payload, or undefined when the value is not a present payload.
 */
function presentedFilesFromResult(
  result: Exclude<ToolExecutionResult, { isError: true }>,
): { turn: number; files: ArchiveFileRequest[] } | undefined {
  const value = result.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as { turn?: unknown; files?: unknown }
  const files = record.files
  if (!Array.isArray(files) || files.length === 0) return undefined
  const requests: ArchiveFileRequest[] = []
  for (const file of files) {
    if (typeof file !== 'object' || file === null || Array.isArray(file)) return undefined
    const path = (file as { path?: unknown }).path
    if (typeof path !== 'string') return undefined
    const description = (file as { description?: unknown }).description
    requests.push({
      path,
      ...typeof description === 'string' ? { description } : {},
    })
  }
  const turn = record.turn
  return {
    turn: typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 1 ? turn : 1,
    files: requests,
  }
}
