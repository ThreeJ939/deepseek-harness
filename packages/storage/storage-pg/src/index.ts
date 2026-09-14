/**
 * PostgreSQL storage backend for the storage hub: one database hosts every
 * routed unit, document-per-row (`key TEXT` / `value JSONB`). Registers as
 * backend `pg`; the disposer unregisters first, then closes the pool.
 * @module @deepseek-ai/dsh-storage-pg
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import pg from 'pg'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { ensureSchema } from './schema.ts'
import { PgKvUnit } from './unit.ts'

export { STORAGE_PG_SCHEMA_VERSION } from './schema.ts'

const { Pool } = pg

/** Cordis plugin name. */
export const name = 'storage-pg'
/** The backend registers on the storage hub. */
export const inject = ['storage']

/** Plugin configuration. */
export interface Config {
  /** PostgreSQL connection string. */
  connectionString: string
  /** Maximum pool size; defaults to 10. */
  poolSize?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  connectionString: z.string().required(),
  poolSize: z.number().step(1).min(1).max(200).default(10),
})

/** Optional extras for tests that inject a pool. */
export interface PgStorageBackendOptions {
  readonly pool?: pg.Pool
}

/**
 * The PostgreSQL {@link StorageBackend}. Owns one connection pool and the
 * open-unit table; `kv.open` validates names, enforces the per-unit version
 * stamp, and ensures the shared record tables.
 */
export class PgStorageBackend implements StorageBackend {
  /** The key-value facet; the only shape this backend serves. */
  readonly kv: KvFacet = { open: descriptor => this.openUnit(descriptor) }

  private readonly ready: Promise<pg.Pool>
  private readonly units = new Map<string, Promise<PgKvUnit>>()
  private closing: Promise<void> | undefined
  private readonly ownsPool: boolean

  /**
   * @param config - Validated plugin configuration.
   * @param options - Optional injected pool for tests.
   */
  constructor(config: Config, options?: PgStorageBackendOptions) {
    this.ownsPool = options?.pool === undefined
    this.ready = this.openPool(config, options?.pool)
    this.ready.catch(() => {})
  }

  private async openPool(config: Config, injected?: pg.Pool): Promise<pg.Pool> {
    const pool = injected ?? new Pool({
      connectionString: config.connectionString,
      max: config.poolSize ?? 10,
    })
    await ensureSchema(pool)
    return pool
  }

  private openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closing !== undefined) {
      return Promise.reject(new StorageError('closed', 'pg storage backend is closed'))
    }
    if (!UNIT_NAME_RE.test(descriptor.name)) {
      return Promise.reject(new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    }
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) {
        return Promise.reject(new Error(`kv table name '${table}' in unit '${descriptor.name}' violates ${UNIT_NAME_RE}`))
      }
    }
    if (this.units.has(descriptor.name)) {
      return Promise.reject(new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`))
    }
    const pending = this.materializeUnit(descriptor)
    this.units.set(descriptor.name, pending)
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  private async materializeUnit(descriptor: KvUnitDescriptor): Promise<PgKvUnit> {
    const pool = await this.ready
    const row = await pool.query('SELECT version FROM storage_units WHERE name = $1', [descriptor.name])
    if (row.rowCount === 0) {
      await pool.query('INSERT INTO storage_units (name, version) VALUES ($1, $2)', [descriptor.name, descriptor.version])
    } else {
      const version = (row.rows[0] as { version: number }).version
      if (version !== descriptor.version) {
        throw new StorageError(
          'version-mismatch',
          `kv unit '${descriptor.name}' is stamped version ${version} on the medium, incompatible with descriptor version ${descriptor.version}`,
        )
      }
    }
    return new PgKvUnit(pool, descriptor, () => {
      this.units.delete(descriptor.name)
    })
  }

  /**
   * Close every open unit and release the pool. Idempotent.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    let pool: pg.Pool
    try {
      pool = await this.ready
    } catch {
      return
    }
    for (const pending of [...this.units.values()]) {
      const unit = await pending.catch(() => undefined)
      await unit?.close()
    }
    if (this.ownsPool) await pool.end()
  }
}

/**
 * Register the PostgreSQL backend as `pg` on the storage hub.
 * @param ctx - Plugin context (must inject `storage`).
 * @param config - Validated plugin configuration.
 * @param options - Optional injected pool for tests.
 */
export function apply(ctx: Context, config: Config, options?: PgStorageBackendOptions) {
  const backend = new PgStorageBackend(config, options)
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register('pg', backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'storage-pg.registerBackend')
  ctx.provide(storageBackendServiceKey('pg'), backend)
}
