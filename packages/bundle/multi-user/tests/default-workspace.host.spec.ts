/**
 * Default Workspace provisioner host specs for the multi-user bundle.
 */
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { UserId } from '@deepseek-ai/dsh-host-auth-middleware'
import SessionStore from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { apply, defaultWorkspacePath } from '../src/default-workspace.ts'
import { WorkspaceFeed } from '../../../api/workspace-controller/src/feed.ts'
import type { WorkspaceFollowFrame } from '../../../api/workspace-controller/src/types.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllEnvs()
})

async function registryHarness() {
  const dshHome = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-default-workspace-')))
  vi.stubEnv('DSH_HOME', dshHome)
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  return { ctx, dshHome }
}

async function harness(options: { dshHome?: string } = {}) {
  const base = await registryHarness()
  const dshHome = options.dshHome ?? base.dshHome
  if (options.dshHome !== undefined) vi.stubEnv('DSH_HOME', dshHome)
  apply(base.ctx, { dshHome })
  return { ctx: base.ctx, dshHome }
}

function principal(userId: string) {
  return { userId: UserId(userId) }
}

async function nextFrame(
  iterator: AsyncIterator<WorkspaceFollowFrame>,
): Promise<WorkspaceFollowFrame> {
  const next = await iterator.next()
  if (next.done === true) throw new Error('Workspace stream ended before the expected frame')
  return next.value
}

describe('defaultWorkspacePath', () => {
  it('joins workspaces/<userId>/default under the harness home', () => {
    expect(defaultWorkspacePath('/home/dsh', 'alice')).toBe(resolve('/home/dsh', 'workspaces', 'alice', 'default'))
  })
})

describe('default-workspace provisioner', () => {
  it('creates the default directory and registry row when the user has none', async () => {
    const { ctx, dshHome } = await harness()
    ctx.provide('authMiddleware', {
      getCurrentPrincipal: () => principal('alice'),
    } as never)

    await ctx.defaultWorkspaceProvisioner.provision()

    const path = defaultWorkspacePath(dshHome, 'alice')
    const listed = ctx.workspaceRegistry.list('alice')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.path).toBe(realpathSync.native(path))
    expect(listed[0]?.title).toBe('default')
    expect(listed[0]?.ownerUserId).toBe('alice')
  })

  it('skips create when the user already owns a Workspace', async () => {
    const { ctx, dshHome } = await harness()
    const existing = join(dshHome, 'custom')
    mkdirSync(existing, { recursive: true })
    await ctx.workspaceRegistry.create(existing, 'Custom', 'alice')
    ctx.provide('authMiddleware', {
      getCurrentPrincipal: () => principal('alice'),
    } as never)

    await ctx.defaultWorkspaceProvisioner.provision()

    expect(ctx.workspaceRegistry.list('alice')).toHaveLength(1)
    expect(ctx.workspaceRegistry.list('alice')[0]?.title).toBe('Custom')
  })

  it('no-ops when authMiddleware is absent or has no principal', async () => {
    const { ctx } = await harness()
    await expect(ctx.defaultWorkspaceProvisioner.provision()).resolves.toBeUndefined()
    expect(ctx.workspaceRegistry.list()).toHaveLength(0)

    ctx.provide('authMiddleware', {
      getCurrentPrincipal: () => undefined,
    } as never)
    await expect(ctx.defaultWorkspaceProvisioner.provision()).resolves.toBeUndefined()
    expect(ctx.workspaceRegistry.list()).toHaveLength(0)
  })

  it('is idempotent across repeated provision calls', async () => {
    const { ctx } = await harness()
    ctx.provide('authMiddleware', {
      getCurrentPrincipal: () => principal('bob'),
    } as never)

    await ctx.defaultWorkspaceProvisioner.provision()
    await ctx.defaultWorkspaceProvisioner.provision()

    expect(ctx.workspaceRegistry.list('bob')).toHaveLength(1)
  })
})

describe('workspace.follow with default-workspace provisioner', () => {
  it('includes the provisioned Workspace in the first baseline', async () => {
    const { ctx, dshHome } = await harness()
    ctx.provide('authMiddleware', {
      getCurrentPrincipal: () => principal('carol'),
    } as never)
    const feed = new WorkspaceFeed(ctx)
    const iterator = feed.follow(new AbortController().signal)[Symbol.asyncIterator]()
    const baseline = await nextFrame(iterator)
    expect(baseline).toMatchObject({
      type: 'baseline',
      value: {
        items: [{
          path: realpathSync.native(defaultWorkspacePath(dshHome, 'carol')),
          title: 'default',
          ownerUserId: 'carol',
        }],
      },
    })
    iterator.return?.()
  })

  it('still delivers a baseline when provision throws', async () => {
    const { ctx } = await registryHarness()
    ctx.provide('defaultWorkspaceProvisioner', {
      provision: () => Promise.reject(new Error('provision boom')),
    })
    const feed = new WorkspaceFeed(ctx)
    const iterator = feed.follow(new AbortController().signal)[Symbol.asyncIterator]()
    await expect(nextFrame(iterator)).resolves.toEqual({
      type: 'baseline',
      value: { items: [], archivedSessionIds: [] },
    })
    iterator.return?.()
  })
})
