import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyOwnedError,
  type SessionPersistence,
} from '@deepseek-ai/dsh-session-persistence'
import { newDb } from 'pg-mem'
import PgSessionPersistence, {
  SCHEMA_VERSION,
} from '../src/index.ts'
import {
  meta,
  oneTurnLog,
  runPersistenceContract,
} from '../../session-persistence/tests/contract.ts'

function memPool(): import('pg').Pool {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  const adapters = db.adapters.createPg() as { Pool: new () => import('pg').Pool }
  return new adapters.Pool()
}

async function mount(pool = memPool()): Promise<{
  persistence: SessionPersistence
  dispose: () => Promise<void>
  pool: import('pg').Pool
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  // Construct directly so tests can inject a pg-mem pool; Cordis class plugins
  // only receive (ctx, config).
  new PgSessionPersistence(
    ctx,
    { connectionString: 'postgresql://test', poolSize: 4 },
    { pool },
  )
  return {
    persistence: ctx.sessionPersistence,
    dispose: async () => {
      await ctx.fiber.dispose()
    },
    pool,
  }
}

runPersistenceContract('pg-mem', async () => {
  const { persistence, dispose, pool } = await mount()
  return {
    persistence,
    dispose,
    reopen: async () => {
      await dispose()
      return mount(pool)
    },
  }
})

describe('session-persistence-pg specifics', () => {
  const disposers: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose()
  })

  it('exposes schema version 2', () => {
    expect(SCHEMA_VERSION).toBe(2)
  })

  it('create/open/append/flush/list/stat round-trip', async () => {
    const { persistence, dispose } = await mount()
    disposers.push(dispose)
    const header = meta('pg-round-trip')
    const handle = await persistence.create(header)
    await handle.append(oneTurnLog())
    await handle.flush()
    await handle.close()

    const listed = await persistence.list()
    expect(listed.some(snapshot => snapshot.header.id === header.id)).toBe(true)
    const stat = await persistence.stat(header.id)
    expect(stat?.header.id).toBe(header.id)

    const reader = await persistence.open(header.id, 'read')
    try {
      const { events } = await reader.read()
      expect(events).toHaveLength(oneTurnLog().length)
      expect(events[0]?.type).toBe('turn/start')
    } finally {
      await reader.close()
    }
  })

  it('rejects a second write open with SessionAlreadyOwnedError', async () => {
    const { persistence, dispose } = await mount()
    disposers.push(dispose)
    const header = meta('pg-owned')
    const writer = await persistence.create(header)
    await writer.append(oneTurnLog())
    await writer.flush()
    await expect(persistence.open(header.id, 'write')).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    await writer.close()
  })

  it('filters list by ownerUserId', async () => {
    const { persistence, dispose } = await mount()
    disposers.push(dispose)
    const owned: SessionHeader = {
      ...meta('pg-owner-a'),
      ownerUserId: 'user-a',
    }
    const other: SessionHeader = {
      ...meta('pg-owner-b'),
      ownerUserId: 'user-b',
    }
    for (const header of [owned, other]) {
      const handle = await persistence.create(header)
      await handle.flush()
      await handle.close()
    }
    const listed = await persistence.list({ ownerUserId: 'user-a' })
    expect(listed.map(snapshot => snapshot.header.id)).toEqual([SessionId('pg-owner-a')])
  })

  it('continues append after reopen', async () => {
    const pool = memPool()
    const first = await mount(pool)
    const header = meta('pg-continue')
    {
      const handle = await first.persistence.create(header)
      await handle.append(oneTurnLog())
      await handle.flush()
      await handle.close()
    }
    await first.dispose()

    const second = await mount(pool)
    disposers.push(second.dispose)
    const writer = await second.persistence.open(header.id, 'write')
    const next: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(6), time: 9, data: { turn: 2 } },
      { type: 'turn/end', seq: SessionSeq(7), time: 10, data: { turn: 2, reason: { kind: 'completed' } } },
    ]
    await writer.append(next)
    await writer.flush()
    await writer.close()
    const reader = await second.persistence.open(header.id, 'read')
    try {
      expect((await reader.read()).events).toHaveLength(8)
    } finally {
      await reader.close()
    }
  })

})
