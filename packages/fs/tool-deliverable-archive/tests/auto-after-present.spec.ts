/** Successful present auto-archives when the archive plugin is mounted. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ArchivedFile } from '../src/types.ts'
import * as Archive from '../src/index.ts'
import * as Present from '@deepseek-ai/dsh-tool-present'

const cleanups: Array<() => Promise<unknown>> = []
let callNumber = 0
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function agent(ctx: Context, cwd: string): Promise<Agent> {
  const id = SessionId(`present-archive-${++callNumber}`)
  let scope: Scope
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
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

async function setup(options: {
  attachments?: boolean
  autoArchiveAfterPresent?: boolean
  maxFiles?: number
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-auto-archive-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-auto-archive-home-'))
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
  await ctx.plugin(Present, { maxFiles: options.maxFiles ?? 8 })
  await ctx.plugin(Archive, {
    maxFiles: options.maxFiles ?? 8,
    autoArchiveAfterPresent: options.autoArchiveAfterPresent ?? true,
  })
  const owner = await agent(ctx, root)
  owner.session.append('turn/start', { turn: 1 })
  const present = (files: unknown) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`present-${++callNumber}`),
    name: 'present',
    arguments: { files },
    agent: owner,
  })
  const archive = (files: unknown) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`archive-${++callNumber}`),
    name: 'archive_deliverable',
    arguments: { files },
    agent: owner,
  })
  return { ctx, owner, root, present, archive }
}

describe('auto-archive after present', () => {
  it('archives on successful present and records both delivery events', async () => {
    const { ctx, owner, root, present } = await setup()
    await writeFile(join(root, 'report.txt'), 'hello-archive')
    const result = await present([{ path: 'report.txt', description: 'Report' }])
    expect(result.isError).toBe(false)
    const presented = owner.session.snapshotEvents().find(event => event.type === 'deliverables/presented')
    const archived = owner.session.snapshotEvents().find(event => event.type === 'deliverables/archived')
    expect(presented?.data.files).toEqual([{ path: 'report.txt', description: 'Report' }])
    expect(archived?.data.files).toHaveLength(1)
    const file = (archived?.data.files as ArchivedFile[])[0]!
    expect(file.path).toBe('report.txt')
    expect(file.description).toBe('Report')
    expect(file.attachment.bytes).toBe(13)
    const chunks: Uint8Array[] = []
    for await (const chunk of ctx.attachments.readFileStream(file.attachment)) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello-archive')
  })

  it('blocks present when no attachment store is mounted', async () => {
    const { owner, root, present } = await setup({ attachments: false })
    await writeFile(join(root, 'a.txt'), 'x')
    const result = await present([{ path: 'a.txt' }])
    expect(result.isError).toBe(true)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('attachment store')
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/presented')).toBe(false)
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/archived')).toBe(false)
  })

  it('skips auto-archive when the switch is off', async () => {
    const { owner, root, present } = await setup({ autoArchiveAfterPresent: false })
    await writeFile(join(root, 'a.txt'), 'only-present')
    const result = await present([{ path: 'a.txt' }])
    expect(result.isError).toBe(false)
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/presented')).toBe(true)
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/archived')).toBe(false)
  })

  it('keeps explicit archive_deliverable available beside auto-archive', async () => {
    const { owner, root, present, archive } = await setup()
    await writeFile(join(root, 'a.txt'), 'a')
    await writeFile(join(root, 'b.txt'), 'b')
    expect((await present([{ path: 'a.txt' }])).isError).toBe(false)
    expect((await archive([{ path: 'b.txt' }])).isError).toBe(false)
    const archived = owner.session.snapshotEvents().filter(event => event.type === 'deliverables/archived')
    expect(archived).toHaveLength(2)
    expect(archived.flatMap(event => event.data.files.map(file => file.path)).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('honors cancellation during auto-archive', async () => {
    const { ctx, owner, root } = await setup()
    await writeFile(join(root, 'big.bin'), Buffer.alloc(128 * 1024, 9))
    const controller = new AbortController()
    controller.abort()
    const result = await ctx.tools.execute({
      signal: controller.signal,
      callId: ToolCallId(`present-${++callNumber}`),
      name: 'present',
      arguments: { files: [{ path: 'big.bin' }] },
      agent: owner,
    })
    expect(result.isError).toBe(true)
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/presented')).toBe(false)
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/archived')).toBe(false)
  })
})
