/**
 * Schema helpers for the PostgreSQL storage backend.
 * @module @deepseek-ai/dsh-storage-pg/schema
 */

import type pg from 'pg'

/** Physical layout version stamped in `storage_meta`. */
export const STORAGE_PG_SCHEMA_VERSION = 1

const ensuredPools = new WeakSet<object>()

/**
 * Ensure the shared KV tables exist and the layout version matches.
 * @param pool - open connection pool.
 */
export async function ensureSchema(pool: pg.Pool): Promise<void> {
  if (ensuredPools.has(pool)) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS storage_meta (
        singleton INTEGER PRIMARY KEY,
        schema_version INTEGER NOT NULL
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS storage_units (
        name TEXT PRIMARY KEY,
        version INTEGER NOT NULL
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS storage_records (
        unit TEXT NOT NULL,
        tbl TEXT NOT NULL,
        key TEXT NOT NULL,
        value JSONB NOT NULL,
        PRIMARY KEY (unit, tbl, key)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS storage_globals (
        unit TEXT PRIMARY KEY,
        value JSONB NOT NULL
      )
    `)
    const meta = await client.query('SELECT schema_version FROM storage_meta WHERE singleton = 1')
    if (meta.rowCount === 0) {
      await client.query(
        'INSERT INTO storage_meta (singleton, schema_version) VALUES (1, $1)',
        [STORAGE_PG_SCHEMA_VERSION],
      )
    } else {
      const version = (meta.rows[0] as { schema_version: number }).schema_version
      if (version !== STORAGE_PG_SCHEMA_VERSION) {
        throw new Error(
          `pg storage schema version ${version} is incompatible with this build (${STORAGE_PG_SCHEMA_VERSION})`,
        )
      }
    }
    await client.query('COMMIT')
    ensuredPools.add(pool)
  } catch (error: unknown) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Retain the original schema failure.
    }
    throw error
  } finally {
    client.release()
  }
}
