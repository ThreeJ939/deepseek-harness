/**
 * PostgreSQL storage primitives: transactional append batches, physical reads,
 * schema initialization, revisions, and lifecycle closure.
 * @module @deepseek-ai/dsh-session-persistence-pg/store
 */

import { randomUUID } from 'node:crypto'
import pg from 'pg'
import {
  SessionLogOffset,
  decodeStorageRecord,
  packChunkRuns,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SessionLogOffset as SessionLogOffsetType,
  type StorageRecord,
} from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceRevision,
  type SessionPersistenceRevision as PersistenceRevision,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import {
  SCHEMA_VERSION,
  decodeEventRow,
  decodeSessionRow,
  decodeStoreIdentity,
  eventRowToEvent,
  rowToMeta,
  type SessionRow,
} from './schema.ts'
import { sql } from './sql.ts'

const { Pool } = pg

/** Pools whose schema and store identity are already initialized in this process. */
const openedPools = new WeakMap<object, string>()

/** Storage options resolved by the service provider. */
export interface PgStoreOptions {
  readonly connectionString: string
  readonly poolSize: number
  /** Optional injected pool (tests); when set, `connectionString` is ignored for construction. */
  readonly pool?: pg.Pool
}

/** Valid stored prefix returned by a physical read. */
export interface StoredPrefix {
  readonly meta: SessionHeader
  readonly events: SessionEvent[]
  readonly revision: PersistenceRevision
  readonly inheritedEventCount: SessionLogOffsetType
}

/** PostgreSQL physical session store. */
export class PgStore {
  readonly name = 'session-persistence-pg'
  private pool!: pg.Pool
  private storeIdentity!: string
  private opened = false
  private ready: Promise<void> | undefined
  private closing: Promise<void> | undefined

  constructor(private readonly options: PgStoreOptions) {}

  /**
   * Lazily open the pool, ensure schema, and clear stale cross-process ownership markers.
   * @returns settlement of the store's one open operation.
   */
  open(): Promise<void> {
    this.ready ??= this.openDb()
    return this.ready
  }

  private async openDb(): Promise<void> {
    this.pool = this.options.pool ?? /* v8 ignore next -- production opens a real PostgreSQL pool */ new Pool({
      connectionString: this.options.connectionString,
      max: this.options.poolSize,
    })
    const cached = openedPools.get(this.pool)
    if (cached !== undefined) {
      this.storeIdentity = cached
      this.opened = true
      return
    }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql('schema'))
      const state = await client.query('SELECT store_id, schema_version FROM persistence_state WHERE singleton = 1')
      if (state.rowCount === 0) {
        const storeId = randomUUID()
        await client.query(
          'INSERT INTO persistence_state (singleton, store_id, schema_version) VALUES (1, $1, $2)',
          [storeId, SCHEMA_VERSION],
        )
        this.storeIdentity = `pg:store:${storeId}`
      } else {
        const row = state.rows[0] as { store_id: string; schema_version: number }
        const onDisk = coerceInt(row.schema_version)
        if (onDisk !== SCHEMA_VERSION) {
          throw new Error(
            `session database has schema version ${onDisk}, incompatible with this build (${SCHEMA_VERSION})`,
          )
        }
        this.storeIdentity = `pg:store:${decodeStoreIdentity({ store_id: row.store_id })}`
      }
      // Clear ownership markers whose claimed PID is not an active PostgreSQL backend.
      // pg-mem and some managed variants omit pg_stat_activity; skip cleanup then.
      try {
        await client.query(`
          UPDATE sessions
          SET is_owned = FALSE, owner_pid = NULL
          WHERE is_owned = TRUE
            AND (owner_pid IS NULL OR owner_pid NOT IN (SELECT pid FROM pg_stat_activity))
        `)
      } catch {
        // Ownership cleanup is best-effort at open; in-process tracking still applies.
      }
      await client.query('COMMIT')
      openedPools.set(this.pool, this.storeIdentity)
      this.opened = true
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Retain the original open failure.
      }
      if (this.options.pool === undefined) await this.pool.end().catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Read the valid stored prefix for one session.
   * @param id - session identity.
   * @param signal - optional cancellation.
   */
  async loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix | undefined> {
    await this.observe(signal)
    const client = await this.pool.connect()
    try {
      signal?.throwIfAborted()
      const session = await client.query('SELECT * FROM sessions WHERE id = $1', [id])
      if (session.rowCount === 0) return undefined
      const row = decodeSessionRow(session.rows[0])
      const events = await client.query(
        'SELECT seq, type, time, data, source_event_seqs, surface_op, ignorable FROM events WHERE session_id = $1 ORDER BY seq ASC',
        [id],
      )
      signal?.throwIfAborted()
      return {
        meta: rowToMeta(row),
        events: events.rows.flatMap((raw) => {
          const eventRow = decodeEventRow(raw)
          // ignorable=false is the pack-row sentinel; decodeStorageRecord validates + expands.
          if (eventRow.ignorable === false) {
            return decodeStorageRecord({
              type: eventRow.type,
              seq0: eventRow.seq,
              time0: eventRow.time,
              data: eventRow.data,
            })
          }
          return [eventRowToEvent(eventRow) as SessionEvent]
        }),
        revision: pgRevision(this.storeIdentity, row),
        inheritedEventCount: SessionLogOffset(row.seed_length ?? 0),
      }
    } finally {
      client.release()
    }
  }

  /**
   * Append a contiguous batch; materializes the session row on first write.
   * @param meta - session header.
   * @param events - contiguous logical events.
   * @param isMaterialized - whether the session already has a durable row.
   * @param inheritedEventCount - fork-inherited prefix length for materialization.
   */
  async appendBatch(
    meta: SessionHeader,
    events: readonly SessionEvent[],
    isMaterialized: boolean,
    inheritedEventCount: SessionLogOffsetType,
  ): Promise<void> {
    await this.open()
    if (events.length === 0) return
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      if (!isMaterialized) {
        await this.writeRow(client, meta, inheritedEventCount)
      } else {
        const existing = await client.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [meta.id])
        if (existing.rowCount === 0) throw new Error(`session ${meta.id} metadata row is missing`)
      }
      const tail = await client.query(
        'SELECT seq, type, data FROM events WHERE session_id = $1 ORDER BY seq DESC LIMIT 1',
        [meta.id],
      )
      const expected = nextExpectedSeq(
        tail.rowCount === 0
          ? undefined
          : {
            seq: coerceInt((tail.rows[0] as { seq: number }).seq),
            type: (tail.rows[0] as { type: string }).type,
            data: (tail.rows[0] as { data: unknown }).data,
          },
      )
      const first = events[0] as SessionEvent
      if (first.seq !== expected) {
        throw new Error(`session ${meta.id} append starts at seq ${first.seq}, stored next seq is ${expected}`)
      }
      for (const record of packChunkRuns(events)) {
        if (isChunkRow(record)) {
          await client.query(
            `INSERT INTO events (session_id, seq, type, time, data, source_event_seqs, surface_op, ignorable)
             VALUES ($1, $2, $3, $4, $5::jsonb, NULL, NULL, FALSE)`,
            [meta.id, record.seq0, record.type, record.time0, JSON.stringify(record.data)],
          )
          continue
        }
        const event = record as SessionEvent & {
          sourceEventSeqs?: unknown
          surfaceOp?: string
          ignorable?: boolean
        }
        await client.query(
          `INSERT INTO events (session_id, seq, type, time, data, source_event_seqs, surface_op, ignorable)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
          [
            meta.id,
            event.seq,
            event.type,
            event.time,
            JSON.stringify(event.data),
            event.sourceEventSeqs === undefined ? null : JSON.stringify(event.sourceEventSeqs),
            event.surfaceOp ?? null,
            event.ignorable === true ? true : null,
          ],
        )
      }
      const updated = await client.query(
        'UPDATE sessions SET revision = revision + 1 WHERE id = $1',
        [meta.id],
      )
      if (updated.rowCount !== 1) throw new Error(`session ${meta.id} metadata row is missing`)
      await client.query('COMMIT')
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError: unknown) {
        /* v8 ignore next -- requires PostgreSQL to fail both the mutation and its rollback */
        throw new AggregateError([error, rollbackError], `${this.name} append failed and rollback also failed`)
      }
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Materialize a header-only session row for an empty durable session.
   * @param meta - immutable session header.
   * @param inheritedEventCount - fork-inherited prefix stored as seed_length.
   */
  async materializeHeader(meta: SessionHeader, inheritedEventCount: SessionLogOffsetType): Promise<void> {
    await this.open()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.writeRow(client, meta, inheritedEventCount)
      await client.query('COMMIT')
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError: unknown) {
        /* v8 ignore next -- requires PostgreSQL to fail both the mutation and its rollback */
        throw new AggregateError([error, rollbackError], `${this.name} materialize failed and rollback also failed`)
      }
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Whether a materialized session row exists.
   * @param id - session identity.
   * @param signal - optional cancellation.
   */
  async hasSession(id: SessionId, signal?: AbortSignal): Promise<boolean> {
    await this.observe(signal)
    const result = await this.pool.query('SELECT 1 FROM sessions WHERE id = $1', [id])
    signal?.throwIfAborted()
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Observe one materialized session without reading event rows.
   * @param id - session identity.
   * @param signal - optional cancellation.
   */
  async snapshot(id: SessionId, signal?: AbortSignal): Promise<SessionPersistenceSnapshot | undefined> {
    await this.observe(signal)
    const result = await this.pool.query('SELECT * FROM sessions WHERE id = $1', [id])
    signal?.throwIfAborted()
    if (result.rowCount === 0) return undefined
    const row = decodeSessionRow(result.rows[0])
    return { header: rowToMeta(row), revision: pgRevision(this.storeIdentity, row) }
  }

  /**
   * Return every materialized header with its source-qualified revision.
   * @param options - optional owner filter and cancellation.
   */
  async listSnapshots(options?: { ownerUserId?: string; signal?: AbortSignal }): Promise<SessionPersistenceSnapshot[]> {
    const signal = options?.signal
    await this.observe(signal)
    const result = options?.ownerUserId === undefined
      ? await this.pool.query('SELECT * FROM sessions')
      : await this.pool.query('SELECT * FROM sessions WHERE owner_id = $1', [options.ownerUserId])
    signal?.throwIfAborted()
    return result.rows.map((raw) => {
      const row = decodeSessionRow(raw)
      return { header: rowToMeta(row), revision: pgRevision(this.storeIdentity, row) }
    })
  }

  /**
   * Close the connection pool.
   */
  async close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    if (this.ready === undefined) return
    await Promise.allSettled([this.ready])
    if (!this.opened) return
    this.opened = false
    // Injected pools are owned by the caller (tests / shared process pools).
    if (this.options.pool !== undefined) return
    /* v8 ignore next -- production pool teardown when the provider owns the pool */
    await this.pool.end()
  }

  private async observe(signal: AbortSignal | undefined): Promise<void> {
    signal?.throwIfAborted()
    await this.open()
    signal?.throwIfAborted()
  }

  private async writeRow(
    client: pg.PoolClient,
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffsetType,
  ): Promise<void> {
    await client.query(
      `INSERT INTO sessions (
         id, owner_id, version, created_at, cwd, parent_session, seed_length,
         origin, delegation_depth, agent_preset, incarnation, revision, is_owned, owner_pid
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,FALSE,NULL)
       ON CONFLICT (id) DO NOTHING`,
      [
        meta.id,
        meta.ownerUserId ?? null,
        meta.version,
        meta.createdAt,
        meta.cwd ?? null,
        meta.parentSession ?? null,
        meta.isSeeded ? inheritedEventCount : null,
        meta.origin ?? null,
        meta.delegationDepth ?? null,
        meta.agentPreset ?? null,
        randomUUID(),
      ],
    )
  }
}

function pgRevision(storeIdentity: string, row: SessionRow): PersistenceRevision {
  return SessionPersistenceRevision(
    `${storeIdentity}:incarnation:${row.incarnation}:revision:${row.revision}`,
  )
}

function coerceInt(value: unknown): number {
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) return Number(value)
  if (!Number.isSafeInteger(value)) throw new Error(`expected safe integer, got ${String(value)}`)
  return value as number
}

/** Whether a packed storage record is a chunk-run row rather than a scalar SessionEvent. */
function isChunkRow(record: StorageRecord): record is Extract<StorageRecord, { seq0: number }> {
  return record.type === 'text-chunks'
    || record.type === 'reasoning-chunks'
    || record.type === 'tool-call-chunks'
}

/**
 * Next logical seq after a physical tail row (pack rows span multiple logical seqs).
 * @param tail - last physical events row, or undefined when the session has no events.
 * @returns the contiguous seq that the next append batch must start at.
 */
function nextExpectedSeq(tail: { seq: number; type: string; data: unknown } | undefined): number {
  if (tail === undefined) return 0
  if (tail.type === 'text-chunks' || tail.type === 'reasoning-chunks' || tail.type === 'tool-call-chunks') {
    if (typeof tail.data !== 'object' || tail.data === null) {
      throw new Error(`malformed ${tail.type} storage row: data must be an object`)
    }
    const payload = tail.type === 'tool-call-chunks'
      ? (tail.data as { args?: unknown }).args
      : (tail.data as { texts?: unknown }).texts
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error(`malformed ${tail.type} storage row: missing member payload`)
    }
    return tail.seq + payload.length
  }
  return tail.seq + 1
}
