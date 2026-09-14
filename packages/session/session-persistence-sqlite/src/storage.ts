/**
 * The SQLite provider's session storage runtime: per-session handles, one
 * in-process writer per id, routed live write-behind, and teardown. The
 * persistence seam exposes only the service and handle contracts.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import {
  assertContiguous,
  materializeAppendBatch,
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionHandleAppendOptions,
  SessionHandleFlushOptions,
  SessionHandleReadOptions,
  SessionHandleReadResult,
} from '@deepseek-ai/dsh-session-persistence'

/** Maximum intentional wait before a routed live session batch starts writing. */
export const LIVE_WRITE_BATCH_MAX_DELAY_MS = 200

/** The SQLite primitives the handle drives on its owning service. */
export interface SqliteHandleStorage {
  /** Append a validated batch; `isMaterialized` selects create-vs-extend. */
  persistBatch(
    header: SessionHeader,
    events: readonly SessionEvent[],
    isMaterialized: boolean,
    inheritedEventCount: SessionLogOffset,
  ): Promise<void>
  /** Materialize the header-only row for an explicitly flushed empty session. */
  persistHeader(header: SessionHeader, inheritedEventCount: SessionLogOffset): Promise<void>
  /** Delete a torn physical tail before the first new append lands. */
  truncateTornTail(header: SessionHeader, tornFrom: number): Promise<void>
  /** Read the valid stored prefix, or `undefined` before materialization. */
  readStored(id: SessionId, signal?: AbortSignal): Promise<readonly SessionEvent[] | undefined>
  /** Whether the id is still a created-but-unmaterialized session here. */
  hasPendingSession(id: SessionId): boolean
  /** Drop the handle's bookkeeping on close. */
  releaseHandle(handle: SqliteSessionHandle, materialized: boolean): void
}

/** Mutable per-handle log state; a write handle is its session's single mutator. */
export interface StorageHandleState {
  /** The stored next-seq (the logical end this handle knows). */
  cursor: number
  /** Whether the session has a durable row yet. */
  materialized: boolean
  /** Torn-tail physical start seq, consumed by the first new append. */
  tornTruncateTo?: number | undefined
  /** Exact fork-inherited prefix length stored with the log; `0` when unseeded. */
  inheritedEventCount: SessionLogOffset
  /** The validated stored prefix from a write open, served to reads until the first append. */
  primed?: SessionHandleReadResult | undefined
}

/**
 * The SQLite session handle. Mutations serialize on a per-handle promise
 * chain; reads never observe a shorter log than a prior read on this handle.
 */
export class SqliteSessionHandle implements SessionHandle {
  private chain: Promise<unknown> = Promise.resolve()
  private closing: Promise<void> | undefined
  private observedLength = 0
  /** Routed live events awaiting their batching deadline (persistence-owned copies). */
  private buffered: SessionEvent[] = []
  private batchTimer: ReturnType<typeof setTimeout> | undefined
  /** Set when a drain failed; the automatic timer stays quiet until the next drain. */
  private drainPaused = false
  private draining: Promise<void> | undefined

  constructor(
    private readonly storage: SqliteHandleStorage,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    private readonly state: StorageHandleState,
  ) {}

  /** Exact fork-inherited prefix length stored with this session's log. */
  get inheritedEventCount(): SessionLogOffset {
    return this.state.inheritedEventCount
  }

  /**
   * Read a slice of the valid contiguous logical log; see the seam contract.
   * @param offset - first logical seq to include (default 0).
   * @param length - maximum events returned (default: the rest).
   * @param options - optional cancellation.
   * @returns the requested slice.
   */
  async read(offset = 0, length = Number.MAX_SAFE_INTEGER, options?: SessionHandleReadOptions): Promise<SessionHandleReadResult> {
    this.assertOpen('read')
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new TypeError(`read offset must be a non-negative safe integer, got ${String(offset)}`)
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new TypeError(`read length must be a non-negative safe integer, got ${String(length)}`)
    }
    options?.signal?.throwIfAborted()
    if (this.state.primed !== undefined) {
      this.observedLength = Math.max(this.observedLength, this.state.primed.events.length)
      return { eventState: this.state.primed.eventState, events: this.state.primed.events.slice(offset, offset + length) }
    }
    if (this.access === 'write' && !this.state.materialized) return { eventState: 'detached', events: [] }
    const events = await this.storage.readStored(this.id, options?.signal)
    if (events === undefined) {
      if (this.storage.hasPendingSession(this.id)) return { eventState: 'detached', events: [] }
      throw new SessionPersistenceNotFoundError(this.id)
    }
    if (events.length < this.observedLength) {
      throw new Error(`session "${this.id}": stored log shrank below a previously observed prefix (${events.length} < ${this.observedLength})`)
    }
    this.observedLength = events.length
    return { eventState: 'detached', events: events.slice(offset, offset + length) }
  }

  /**
   * Durably append a contiguous batch; see the seam contract.
   * @param events - the contiguous batch in seq order.
   * @param options - optional cancellation observed before the write starts.
   */
  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    this.assertOpen('append')
    const batch = materializeAppendBatch(events)
    return this.run('append', async () => {
      options?.signal?.throwIfAborted()
      await this.persistContiguous(batch)
    })
  }

  /**
   * Durability barrier; materializes the session row when nothing has been
   * appended yet, so an explicitly flushed empty session survives this process.
   * @param options - optional cancellation observed before the barrier starts.
   */
  flush(options?: SessionHandleFlushOptions): Promise<void> {
    return this.run('flush', async () => {
      options?.signal?.throwIfAborted()
      if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'flush')
      if (this.state.materialized) return
      await this.storage.persistHeader(this.header, this.state.inheritedEventCount)
      this.state.materialized = true
    })
  }

  /**
   * Release the handle; see the seam contract. Idempotent and uncancellable.
   * @returns settlement of the release.
   */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      let drainFailure: unknown
      for (;;) {
        try {
          await this.drainLive()
        } catch (error: unknown) {
          drainFailure = error
          break
        }
        await this.chain
        if (this.buffered.length === 0) break
      }
      await this.chain
      this.storage.releaseHandle(this, this.state.materialized)
      if (drainFailure !== undefined) {
        throw drainFailure instanceof Error ? drainFailure : new Error(errorChain(drainFailure))
      }
    })()
  }

  /** `await using` support: delegates to {@link close}. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  /**
   * Buffer one published live session event and arm the bounded batching
   * window when it is idle.
   * @param event - the live event, retained as a persistence-owned copy.
   * @param reportBackgroundFailure - observes a deadline-driven drain failure.
   */
  enqueueLive(event: SessionEvent, reportBackgroundFailure: (error: unknown) => void): void {
    this.buffered.push(structuredClone(event))
    if (this.batchTimer !== undefined || this.drainPaused) return
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined
      this.drainLive().catch(reportBackgroundFailure)
    }, LIVE_WRITE_BATCH_MAX_DELAY_MS)
  }

  /**
   * Durably drain the routed live buffer through the mutation chain.
   */
  drainLive(): Promise<void> {
    return this.draining ??= this.drainBuffered().finally(() => {
      this.draining = undefined
    })
  }

  private async drainBuffered(): Promise<void> {
    if (this.batchTimer !== undefined) {
      clearTimeout(this.batchTimer)
      this.batchTimer = undefined
    }
    this.drainPaused = false
    while (this.buffered.length > 0) {
      await this.enqueueChain(async () => {
        const batch = this.buffered.splice(0)
        try {
          await this.persistContiguous(materializeAppendBatch(batch))
        } catch (error: unknown) {
          this.buffered = batch.concat(this.buffered)
          this.drainPaused = true
          throw error
        }
      })
    }
  }

  private async persistContiguous(batch: readonly SessionEvent[]): Promise<void> {
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'append')
    if (batch.length === 0) return
    assertContiguous(this.id, batch, this.state.cursor)
    if (this.state.tornTruncateTo !== undefined) {
      await this.storage.truncateTornTail(this.header, this.state.tornTruncateTo)
      this.state.tornTruncateTo = undefined
    }
    await this.storage.persistBatch(this.header, batch, this.state.materialized, this.state.inheritedEventCount)
    this.state.materialized = true
    this.state.cursor += batch.length
    this.state.primed = undefined
    this.observedLength = this.state.cursor
  }

  private enqueueChain(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op)
    this.chain = next.catch(() => {})
    return next
  }

  private async run(operation: string, op: () => Promise<void>): Promise<void> {
    this.assertOpen(operation)
    return this.enqueueChain(async () => {
      this.assertOpen(operation)
      return op()
    })
  }

  private assertOpen(operation: string): void {
    if (this.closing !== undefined) throw new SessionHandleClosedError(this.id, operation)
  }
}

/** One created-but-unmaterialized session tracked in this process only. */
export interface PendingSession {
  readonly header: SessionHeader
  readonly revision: SessionPersistenceRevision
  readonly inheritedEventCount: SessionLogOffset
}

/**
 * In-process bookkeeping: one active writer per session id, the open-handle
 * set the teardown sweep closes, and created-but-unmaterialized sessions.
 */
export class SqliteBackendTracker {
  readonly openHandles = new Set<SessionHandle>()
  /** `null` marks a claim whose handle is still being constructed. */
  private readonly writers = new Map<SessionId, SqliteSessionHandle | null>()
  private readonly pending = new Map<SessionId, PendingSession>()
  private counter = 0

  /** @param name - backend label used in in-memory revision tokens and teardown errors. */
  constructor(private readonly name: string) {}

  /**
   * Claim write ownership and record the created session as pending.
   * @param header - the validated detached header.
   * @param inheritedEventCount - the exact fork-inherited prefix length.
   */
  registerCreated(header: SessionHeader, inheritedEventCount: SessionLogOffset): void {
    if (this.writers.has(header.id)) throw new SessionAlreadyExistsError(header.id)
    this.writers.set(header.id, null)
    this.pending.set(header.id, {
      header,
      revision: SessionPersistenceRevision(`memory:${this.name}:${++this.counter}`),
      inheritedEventCount,
    })
  }

  /**
   * Claim write ownership for an existing session.
   * @param id - the session to claim.
   */
  claimWrite(id: SessionId): void {
    if (this.writers.has(id)) throw new SessionAlreadyOwnedError(id)
    this.writers.set(id, null)
  }

  /**
   * Roll a failed write open back.
   * @param id - the session whose claim is dropped.
   */
  releaseClaim(id: SessionId): void {
    this.writers.delete(id)
  }

  /**
   * The pending entry for a created-but-unmaterialized session, if any.
   * @param id - the session to look up.
   */
  pendingOf(id: SessionId): PendingSession | undefined {
    return this.pending.get(id)
  }

  /**
   * Whether this process still tracks a created-but-unmaterialized session.
   * @param id - the session to test.
   */
  hasPending(id: SessionId): boolean {
    return this.pending.has(id)
  }

  /**
   * Iterate the pending sessions for listing.
   */
  pendingEntries(): IterableIterator<[SessionId, PendingSession]> {
    return this.pending.entries()
  }

  /**
   * Drop a pending entry once the session materialized durably.
   * @param id - the session that reached durable storage.
   */
  materialized(id: SessionId): void {
    this.pending.delete(id)
  }

  /**
   * Track one open handle for teardown and bind a write handle as the live route.
   * @param handle - the just-constructed handle.
   */
  adopt(handle: SqliteSessionHandle): SqliteSessionHandle {
    this.openHandles.add(handle)
    if (handle.access === 'write') this.writers.set(handle.id, handle)
    return handle
  }

  /**
   * Release one handle's bookkeeping on close.
   * @param handle - the closing handle.
   * @param materialized - whether the session reached durable storage.
   */
  release(handle: SqliteSessionHandle, materialized: boolean): void {
    this.openHandles.delete(handle)
    if (handle.access !== 'write') return
    this.writers.delete(handle.id)
    if (!materialized) this.pending.delete(handle.id)
  }

  /**
   * Drain and flush every active write handle.
   */
  async flushAll(): Promise<void> {
    const errors: unknown[] = []
    for (const writer of [...this.writers.values()]) {
      if (writer === null) continue
      try {
        await writer.drainLive()
        await writer.flush()
      } catch (error: unknown) {
        if (error instanceof SessionHandleClosedError) continue
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `${this.name} flush failed`)
  }

  /**
   * Install live session routing and teardown.
   * @param ctx - the backend's context.
   */
  install(ctx: Context): void {
    ctx.on('session/event', (session: Session, event) => {
      this.writers.get(session.id)?.enqueueLive(event, (error) => {
        ctx.logger.warn(`session-persistence: background write for session "${session.id}" failed (buffered events retained): ${String(error)}`)
      })
    })
    ctx.on('session/flush', (session: Session) => {
      const writer = this.writers.get(session.id)
      if (writer === null || writer === undefined) return undefined
      return (async () => {
        await writer.drainLive()
        await writer.flush()
      })()
    })
    ctx.on('session/disposed', (session: Session) => {
      const writer = this.writers.get(session.id)
      if (writer === null || writer === undefined) return
      writer.close().catch((error: unknown) => {
        ctx.logger.warn(`session-persistence: final drain for session "${session.id}" failed: ${String(error)}`)
      })
    })
    ctx.effect(() => async () => {
      const errors: unknown[] = []
      for (const handle of [...this.openHandles]) {
        try {
          await handle.close()
        } catch (error: unknown) {
          errors.push(error)
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, `${this.name} dispose failed`)
    }, `${this.name} open handles`)
  }
}
