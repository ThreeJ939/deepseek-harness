/** Archive_deliverable commits bytes before publishing the durable event. */
import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { ArchivedFile } from '../src/types.ts'
import * as Archive from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
let callNumber = 0
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

async function agent(ctx: Context, cwd: string | undefined): Promise<Agent> {
  const id = SessionId(`archive-owner-${++callNumber}`)
  let scope: Scope
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, ...cwd === undefined ? {} : { cwd }, isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    get ctx() { return scope.ctx },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, value) }, { inject: ['tools'] }))
  ctx.agents.register(value)
  return value
}

async function setup(options: { attachments?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-archive-minimal-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-archive-home-'))
  cleanups.push(() => rm(dshHome, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  if (options.attachments !== false) {
    await ctx.plugin(LocalAttachmentStore, { dshHome })
  }
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  const fiber = ctx.plugin(Archive, { maxFiles: 2, autoArchiveAfterPresent: false })
  await fiber
  const owner = await agent(ctx, root)
  owner.session.append('turn/start', { turn: 1 })
  const execute = (files: unknown) => ctx.tools.execute({
    signal: new AbortController().signal, callId: ToolCallId(`call-${++callNumber}`),
    name: 'archive_deliverable', arguments: { files }, agent: owner,
  })
  return { ctx, owner, root, dshHome, fiber, execute }
}

describe('archive_deliverable', () => {
  it('copies file bytes into the attachment store and records one archived delivery', async () => {
    const { ctx, owner, root, execute, fiber } = await setup()
    const data = Uint8Array.of(80, 75, 0, 255)
    await writeFile(join(root, '报告.docx'), data)
    const result = await execute([{ path: '报告.docx', description: 'Report' }])
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('archive failed')
    const files = (result.value as unknown as { files: ArchivedFile[] }).files
    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe('报告.docx')
    expect(files[0]?.description).toBe('Report')
    expect(files[0]?.attachment.name).toBe('报告.docx')
    expect(files[0]?.attachment.bytes).toBe(4)
    expect(files[0]?.attachment.attachmentId).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(owner.session.snapshotEvents().find(event => event.type === 'deliverables/archived')?.data.files)
      .toEqual(files)
    const chunks: Uint8Array[] = []
    for await (const chunk of ctx.attachments.readFileStream(files[0]!.attachment)) chunks.push(chunk)
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(data))
    await fiber.dispose()
    expect(ctx.tools.get('archive_deliverable', owner)).toBeUndefined()
  })

  it('fails clearly when no attachment store is mounted', async () => {
    const { root, execute } = await setup({ attachments: false })
    await writeFile(join(root, 'a.txt'), 'hello')
    const result = await execute([{ path: 'a.txt' }])
    expect(result.isError).toBe(true)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('attachment store')
  })

  it('ignores a different archive_deliverable definition in the calling agent scope', async () => {
    const { owner, execute } = await setup()
    owner.ctx.tools.register(defineTool({
      name: 'archive_deliverable', description: 'Scoped replacement.', parameters: {},
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            turn: { type: 'integer', required: true },
            files: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: () => [],
      },
      execute: async () => ({ turn: 1, files: [] }),
    }))
    expect((await execute([])).isError).toBe(false)
    expect(owner.session.snapshotEvents().filter(event => event.type === 'deliverables/archived')).toEqual([])
  })

  it('does not publish archives after post-execute blocks a successful declaration', async () => {
    const { ctx, root, owner, execute } = await setup()
    await writeFile(join(root, 'a'), 'a')
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      await next()
      return { kind: 'block', feedback: [{ type: 'text', text: 'blocked' }] }
    })
    expect((await execute([{ path: 'a' }])).isError).toBe(true)
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/archived')).toBe(false)
  })

  it('rejects missing, non-file, empty, and excessive inputs', async () => {
    const { root, owner, execute } = await setup()
    await writeFile(join(root, 'large'), 'four')
    await mkdir(join(root, 'outside'))
    for (const files of [[], [{ path: '' }], [{ path: 'missing' }], [{ path: '.' }], [{ path: 'outside' }], [{ path: 'large' }, { path: 'large' }, { path: 'large' }]]) {
      const result = await execute(files)
      expect(result.isError, JSON.stringify(files)).toBe(true)
    }
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/archived')).toBe(false)
  })

  it('honors cancellation before the attachment write finishes', async () => {
    const { ctx, root, owner } = await setup()
    await writeFile(join(root, 'a.bin'), Buffer.alloc(128 * 1024, 7))
    const controller = new AbortController()
    controller.abort()
    const result = await ctx.tools.execute({
      signal: controller.signal,
      callId: ToolCallId(`call-${++callNumber}`),
      name: 'archive_deliverable',
      arguments: { files: [{ path: 'a.bin' }] },
      agent: owner,
    })
    expect(result.isError).toBe(true)
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/archived')).toBe(false)
  })
})

it('validates deployment limits before registering the tool', () => {
  for (const config of [
    { maxFiles: 0, autoArchiveAfterPresent: true },
    { maxFiles: 1.5, autoArchiveAfterPresent: true },
    { maxFiles: Number.POSITIVE_INFINITY, autoArchiveAfterPresent: true },
  ]) {
    expect(() => { Archive.apply(new Context(), config) }).toThrow('positive integer maxFiles')
  }
})

it('requires an agent, an open turn, and a workspace', async () => {
  const { ctx, owner, execute } = await setup()
  const detached = await ctx.tools.execute({
    signal: new AbortController().signal, callId: ToolCallId('detached'),
    name: 'archive_deliverable', arguments: { files: [{ path: 'a' }] },
  })
  expect(detached.isError).toBe(true)
  owner.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect((await execute([{ path: 'a' }])).isError).toBe(true)
  const noWorkspace = await agent(ctx, undefined)
  noWorkspace.session.append('turn/start', { turn: 1 })
  const absent = await ctx.tools.execute({
    signal: new AbortController().signal, callId: ToolCallId('no-workspace'),
    name: 'archive_deliverable', arguments: { files: [{ path: 'a' }] }, agent: noWorkspace,
  })
  expect(absent.isError).toBe(true)
})

it.skipIf(process.platform === 'win32')('refuses a final symlink to an ordinary file', async () => {
  const { root, execute } = await setup()
  await writeFile(join(root, 'source'), 'source')
  await symlink(join(root, 'source'), join(root, 'link'))
  expect((await execute([{ path: 'link' }])).isError).toBe(true)
})
