/**
 * Opt-in SQLite persistence provider. Logical sessions remain unchanged;
 * the physical backend packs eligible chunk runs into schema-18 rows and
 * serves the handle-based `SessionPersistence` API.
 * @module @deepseek-ai/dsh-session-persistence-sqlite
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
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
import type { JournalMode } from './schema.ts'
import { SqliteStore } from './store.ts'
import { SqliteBackendTracker, SqliteSessionHandle } from './storage.ts'

export { SCHEMA_VERSION } from './schema.ts'

/** Default wait for another SQLite connection's write reservation. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000
/** Largest busy timeout accepted by SQLite's signed millisecond interface. */
export const MAX_BUSY_TIMEOUT_MS = 2_147_483_647

/** Plugin configuration. */
export interface Config {
  /** SQLite database path, or `:memory:` for an in-process database. */
  path: string
  /** Durable SQLite journal mode; defaults to `wal`. */
  journalMode?: JournalMode
  /** Maximum wait for another SQLite connection's lock; defaults to 5,000 ms. */
  busyTimeoutMs?: number
}

/**
 * SQLite `SessionPersistence` provider with a schema-owned physical codec.
 */
export class SqliteSessionPersistence extends SessionPersistence {
  override readonly name = 'session-persistence-sqlite'

  static Config: z<Config> = z.object({
    path: z.string().required(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeoutMs: z.number().step(1).min(0).max(MAX_BUSY_TIMEOUT_MS).default(DEFAULT_BUSY_TIMEOUT_MS),
  })

  private readonly store: SqliteStore
  private readonly tracker = new SqliteBackendTracker(this.name)

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.store = new SqliteStore({
      path: config.path,
      journalMode: config.journalMode ?? 'wal',
      busyTimeoutMs: config.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    })
    this.tracker.install(ctx)
    ctx.effect(() => async () => {
      await this.store.close()
    }, `${this.name} store`)
  }

  /** Reject self-contained path and ownership failures without loading Node SQLite. */
  protected async [Service.init](): Promise<void> {
    await this.store.validatePath()
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
    return this.tracker.adopt(new SqliteSessionHandle(this, snapshot.id, snapshot, 'write', {
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
        return this.tracker.adopt(new SqliteSessionHandle(this, id, pending.header, 'read', {
          cursor: 0,
          materialized: false,
          inheritedEventCount: pending.inheritedEventCount,
        }))
      }
      const stored = await this.requireStored(id, options?.signal)
      return this.tracker.adopt(new SqliteSessionHandle(this, id, stored.meta, 'read', {
        cursor: 0,
        materialized: true,
        inheritedEventCount: stored.inheritedEventCount,
      }))
    }
    this.tracker.claimWrite(id)
    try {
      const stored = await this.requireStored(id, options?.signal)
      return this.tracker.adopt(new SqliteSessionHandle(this, id, stored.meta, 'write', {
        cursor: stored.events.length,
        materialized: true,
        tornTruncateTo: stored.tornMarker,
        inheritedEventCount: stored.inheritedEventCount,
        primed: { eventState: 'detached', events: stored.events },
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
   * Delete a torn physical tail durably before this session's first new append.
   * @param header - the session's stored header.
   * @param tornFrom - first physical seq of the torn tail.
   */
  async truncateTornTail(header: SessionHeader, tornFrom: number): Promise<void> {
    await this.store.commitRepair(header, tornFrom, [])
    this.ctx.logger.warn(`${this.name}: session "${header.id}" recovered from a torn tail; incomplete tail rows were discarded`)
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
  releaseHandle(handle: SqliteSessionHandle, materialized: boolean): void {
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

export default SqliteSessionPersistence
