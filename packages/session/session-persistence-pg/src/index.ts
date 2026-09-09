/**
 * Opt-in PostgreSQL persistence provider. Logical sessions remain unchanged;
 * the physical backend stores one JSONB row per logical event and serves the
 * handle-based `SessionPersistence` API.
 * @module @deepseek-ai/dsh-session-persistence-pg
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Pool } from 'pg'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset as SessionLogOffsetType } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyExistsError,
  SessionPersistence,
  SessionPersistenceNotFoundError,
  assertStoredId,
  assertVersion,
  materializeCreateHeader,
  validateStoredEvents,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import { PgStore } from './store.ts'
import { PgBackendTracker, PgSessionHandle } from './storage.ts'

export { SCHEMA_VERSION } from './schema.ts'
export { PgStore } from './store.ts'

/** Default maximum connections in the PostgreSQL pool. */
export const DEFAULT_POOL_SIZE = 10

/** Plugin configuration. */
export interface Config {
  /** PostgreSQL connection string (`postgresql://…`). */
  connectionString: string
  /** Maximum pool size; defaults to 10. */
  poolSize?: number
}

/** Optional constructor extras used by unit tests that inject a pool. */
export interface PgSessionPersistenceOptions {
  /** Injected `pg.Pool` (or pool-compatible adapter); skips `new Pool(connectionString)`. */
  readonly pool?: Pool
}

/**
 * PostgreSQL `SessionPersistence` provider.
 */
export class PgSessionPersistence extends SessionPersistence {
  override readonly name = 'session-persistence-pg'

  static Config: z<Config> = z.object({
    connectionString: z.string().required(),
    poolSize: z.number().step(1).min(1).max(200).default(DEFAULT_POOL_SIZE),
  })

  private readonly store: PgStore
  private readonly tracker = new PgBackendTracker(this.name)

  constructor(ctx: Context, public config: Config, options?: PgSessionPersistenceOptions) {
    super(ctx)
    this.store = new PgStore({
      connectionString: config.connectionString,
      poolSize: config.poolSize ?? DEFAULT_POOL_SIZE,
      ...options?.pool !== undefined ? { pool: options.pool } : {},
    })
    this.tracker.install(ctx)
    ctx.effect(() => async () => {
      await this.store.close()
    }, `${this.name} store`)
  }

  /**
   * Create a new stored session and take its write ownership.
   * @param header - the immutable header to store.
   * @param options - optional cancellation and inherited prefix length.
   * @returns the owned write handle.
   */
  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader(header)
    const inheritedEventCount = SessionLogOffset(options?.inheritedEventCount ?? 0)
    if (snapshot.isSeeded && options?.inheritedEventCount === undefined) {
      throw new TypeError('session create requires inheritedEventCount when header.isSeeded is true')
    }
    if (!snapshot.isSeeded && inheritedEventCount !== 0) {
      throw new TypeError('session create inheritedEventCount must be 0 when header.isSeeded is false')
    }
    options?.signal?.throwIfAborted()
    if (this.tracker.hasPending(snapshot.id) || await this.store.hasSession(snapshot.id, options?.signal)) {
      throw new SessionAlreadyExistsError(snapshot.id)
    }
    options?.signal?.throwIfAborted()
    this.tracker.registerCreated(snapshot, inheritedEventCount)
    return this.tracker.adopt(new PgSessionHandle(this, snapshot.id, snapshot, 'write', {
      cursor: 0,
      materialized: false,
      inheritedEventCount,
    }))
  }

  /**
   * Open an existing stored session for `read` or single-writer `write`.
   * @param id - the stored session to open.
   * @param access - `read` (no ownership) or `write` (atomic in-process claim).
   * @param options - optional cancellation.
   * @returns the open handle.
   */
  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const pending = this.tracker.pendingOf(id)
    if (access === 'read') {
      if (pending !== undefined) {
        return this.tracker.adopt(new PgSessionHandle(this, id, pending.header, 'read', {
          cursor: 0,
          materialized: false,
          inheritedEventCount: pending.inheritedEventCount,
        }))
      }
      const stored = await this.requireStored(id, options?.signal)
      return this.tracker.adopt(new PgSessionHandle(this, id, stored.meta, 'read', {
        cursor: 0,
        materialized: true,
        inheritedEventCount: stored.inheritedEventCount,
      }))
    }
    this.tracker.claimWrite(id)
    try {
      const stored = await this.requireStored(id, options?.signal)
      return this.tracker.adopt(new PgSessionHandle(this, id, stored.meta, 'write', {
        cursor: stored.events.length,
        materialized: true,
        inheritedEventCount: stored.inheritedEventCount,
        primed: stored.events,
      }))
    } catch (error) {
      this.tracker.releaseClaim(id)
      throw error
    }
  }

  /**
   * Flush every active write handle in one durability barrier.
   */
  flush(): Promise<void> {
    return this.tracker.flushAll()
  }

  /**
   * Observe one stored session without reading its event log.
   * @param id - the stored session to observe.
   * @param options - optional cancellation.
   */
  async stat(
    id: SessionId,
    options?: SessionPersistenceStatOptions,
  ): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted()
    const pending = this.tracker.pendingOf(id)
    if (pending !== undefined) {
      return { header: pending.header, revision: pending.revision }
    }
    return this.store.snapshot(id, options?.signal)
  }

  /**
   * List every stored session visible to this process, including this
   * process's created-but-unmaterialized sessions.
   * @param options - optional owner filter and cancellation.
   */
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const signal = options?.signal
    const ownerUserId = options?.ownerUserId
    const snapshots: SessionPersistenceSnapshot[] = []
    const listed = new Set<SessionId>()
    const pending = [...this.tracker.pendingEntries()]
    for (const snapshot of await this.store.listSnapshots({
      ...ownerUserId === undefined ? {} : { ownerUserId },
      ...signal === undefined ? {} : { signal },
    })) {
      listed.add(snapshot.header.id)
      snapshots.push(snapshot)
    }
    for (const [id, entry] of pending) {
      if (listed.has(id)) continue
      if (ownerUserId !== undefined && entry.header.ownerUserId !== ownerUserId) continue
      snapshots.push({ header: entry.header, revision: entry.revision })
    }
    signal?.throwIfAborted()
    return snapshots
  }

  /**
   * Durably append one validated batch; lazily materializes on the first write.
   * @param header - the session's stored header.
   * @param events - the validated contiguous batch, in seq order.
   * @param isMaterialized - whether the session already has a durable row.
   * @param inheritedEventCount - stored with a materializing header row.
   */
  async persistBatch(
    header: SessionHeader,
    events: readonly SessionEvent[],
    isMaterialized: boolean,
    inheritedEventCount: SessionLogOffsetType,
  ): Promise<void> {
    await this.store.appendBatch(header, events, isMaterialized, inheritedEventCount)
    if (!isMaterialized) this.tracker.materialized(header.id)
  }

  /**
   * Materialize a header-only row for an explicitly durable empty session.
   * @param header - the session's stored header.
   * @param inheritedEventCount - stored with the header row.
   */
  async persistHeader(header: SessionHeader, inheritedEventCount: SessionLogOffsetType): Promise<void> {
    await this.store.materializeHeader(header, inheritedEventCount)
    this.tracker.materialized(header.id)
  }

  /**
   * Whether this process still tracks a created-but-unmaterialized session.
   * @param id - the session to test.
   */
  hasPendingSession(id: SessionId): boolean {
    return this.tracker.hasPending(id)
  }

  /**
   * Release one handle's backend bookkeeping on close.
   * @param handle - the closing handle.
   * @param materialized - whether the session reached durable storage.
   */
  releaseHandle(handle: PgSessionHandle, materialized: boolean): void {
    this.tracker.release(handle, materialized)
  }

  /**
   * Read the valid stored prefix for one session.
   * @param id - the stored session.
   * @param signal - optional cancellation.
   */
  async readStored(id: SessionId, signal?: AbortSignal): Promise<readonly SessionEvent[] | undefined> {
    const stored = await this.loadStored(id, signal)
    return stored?.events
  }

  private async requireStored(id: SessionId, signal?: AbortSignal) {
    const stored = await this.loadStored(id, signal)
    if (stored === undefined) throw new SessionPersistenceNotFoundError(id)
    return stored
  }

  private async loadStored(id: SessionId, signal?: AbortSignal) {
    const stored = await this.store.loadStored(id, signal)
    if (stored === undefined) return undefined
    assertStoredId(id, stored.meta)
    assertVersion(stored.meta)
    validateStoredEvents(stored.meta, stored.events)
    return stored
  }
}

export default PgSessionPersistence
