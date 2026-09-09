import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { newDb } from 'pg-mem'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { runKvBackendContract } from '../../storage/tests/contract.ts'
import { Config, PgStorageBackend, STORAGE_PG_SCHEMA_VERSION, apply, name, inject } from '../src/index.ts'

function memPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  const { Pool } = db.adapters.createPg()
  return new Pool() as import('pg').Pool
}

runKvBackendContract('pg-mem', async () => {
  const pool = memPool()
  return {
    backend: new PgStorageBackend(new Config({ connectionString: 'postgresql://test' }), { pool }),
    reopen: async () => new PgStorageBackend(new Config({ connectionString: 'postgresql://test' }), { pool }),
  }
})

describe('storage-pg specifics', () => {
  const disposers: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose()
  })

  it('exports plugin metadata', () => {
    expect(name).toBe('storage-pg')
    expect(inject).toEqual(['storage'])
  })

  it('stamps schema version 1', async () => {
    const pool = memPool()
    const backend = new PgStorageBackend(new Config({ connectionString: 'postgresql://test' }), { pool })
    disposers.push(() => backend.close())
    const unit = await backend.kv!.open({
      name: 'specimen',
      version: 1,
      tables: ['records'],
      hasGlobal: true,
    })
    await unit.putRecord('records', 'k', { n: 1 })
    await backend.close()
    const meta = await pool.query('SELECT schema_version FROM storage_meta WHERE singleton = 1')
    expect(Number((meta.rows[0] as { schema_version: number }).schema_version)).toBe(STORAGE_PG_SCHEMA_VERSION)
  })

  it('apply registers backend pg and provides the service key', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const pool = memPool()
    apply(ctx, new Config({ connectionString: 'postgresql://test' }), { pool })
    expect(ctx.storage.backend.get('pg')).toBeDefined()
    expect(ctx.get(storageBackendServiceKey('pg'))).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('rejects double-open of the same unit', async () => {
    const pool = memPool()
    const backend = new PgStorageBackend(new Config({ connectionString: 'postgresql://test' }), { pool })
    disposers.push(() => backend.close())
    const descriptor = { name: 'once', version: 1, tables: ['t'], hasGlobal: false }
    await backend.kv!.open(descriptor)
    await expect(backend.kv!.open(descriptor)).rejects.toThrow(/already open/)
  })
})
