/**
 * One opened PostgreSQL KV unit over shared `storage_records` / `storage_globals`.
 * @module @deepseek-ai/dsh-storage-pg/unit
 */

import type pg from 'pg'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

/**
 * The PostgreSQL {@link KvUnit}. Values are stored as JSONB.
 */
export class PgKvUnit implements KvUnit {
  private closed = false

  /**
   * @param pool - Open pool owned by the backend (never closed here).
   * @param descriptor - Validated descriptor.
   * @param onClose - Backend callback releasing this unit's open-name slot.
   */
  constructor(
    private readonly pool: pg.Pool,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onClose: () => void,
  ) {}

  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    return this.settle(async () => {
      const tables: Record<string, Record<string, unknown>> = {}
      for (const table of this.descriptor.tables) {
        const records: Record<string, unknown> = Object.create(null) as Record<string, unknown>
        const result = await this.pool.query(
          'SELECT key, value FROM storage_records WHERE unit = $1 AND tbl = $2',
          [this.descriptor.name, table],
        )
        for (const row of result.rows as Array<{ key: string; value: unknown }>) {
          records[row.key] = row.value
        }
        tables[table] = records
      }
      let global: unknown = null
      if (this.descriptor.hasGlobal) {
        const result = await this.pool.query(
          'SELECT value FROM storage_globals WHERE unit = $1',
          [this.descriptor.name],
        )
        if ((result.rowCount ?? 0) > 0) global = (result.rows[0] as { value: unknown }).value
      }
      return { tables, global }
    })
  }

  putRecord(table: string, key: string, value: unknown): Promise<void> {
    return this.settle(async () => {
      this.assertTable(table)
      await this.pool.query(
        `INSERT INTO storage_records (unit, tbl, key, value)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (unit, tbl, key) DO UPDATE SET value = excluded.value`,
        [this.descriptor.name, table, key, JSON.stringify(value)],
      )
    })
  }

  deleteRecord(table: string, key: string): Promise<void> {
    return this.settle(async () => {
      this.assertTable(table)
      await this.pool.query(
        'DELETE FROM storage_records WHERE unit = $1 AND tbl = $2 AND key = $3',
        [this.descriptor.name, table, key],
      )
    })
  }

  setGlobal(value: unknown): Promise<void> {
    return this.settle(async () => {
      if (!this.descriptor.hasGlobal) {
        throw new Error(`kv unit '${this.descriptor.name}' declared no global slot`)
      }
      await this.pool.query(
        `INSERT INTO storage_globals (unit, value)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (unit) DO UPDATE SET value = excluded.value`,
        [this.descriptor.name, JSON.stringify(value)],
      )
    })
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.onClose()
    }
    return Promise.resolve()
  }

  private assertTable(table: string): void {
    if (!this.descriptor.tables.includes(table)) {
      throw new Error(`kv unit '${this.descriptor.name}' declared no table '${table}'`)
    }
  }

  private settle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      this.ensureOpen()
      return operation().catch((error: unknown) => {
        throw error instanceof Error ? error : new Error(String(error))
      })
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `kv unit '${this.descriptor.name}' is closed`)
    }
  }
}
