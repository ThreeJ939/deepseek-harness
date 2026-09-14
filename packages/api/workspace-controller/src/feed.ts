/** Reconnect-safe Workspace baseline and increment producer. */

import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { Workspace, WorkspaceRecord } from '@deepseek-ai/dsh-workspace'
import {
  workspaceDomainState,
  workspaceRecord,
  WorkspaceId,
} from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkspaceBaseline,
  WorkspaceFollowFrame,
  WorkspaceFollowIncrement,
  WorkspaceView,
} from './types.ts'
import { archivedSessionIdsForViewer, getPrincipal, sessionOwnerUserId } from './ownership.ts'
import type {} from './default-workspace-provisioner.ts'

/**
 * Project one authoritative Workspace entity into its Remote value.
 * @param workspace - authoritative registry entity.
 * @returns detached Workspace projection for Remote consumers.
 */
export function workspaceView(workspace: Workspace): WorkspaceView {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    ...workspace.ownerUserId === undefined ? {} : { ownerUserId: workspace.ownerUserId },
  }
}

function changedWorkspaceView(workspaceId: string, value: unknown): WorkspaceView {
  const record: WorkspaceRecord = workspaceRecord.parse(value)
  return {
    workspaceId: WorkspaceId(workspaceId),
    path: record.path,
    title: record.title,
    sessionIds: [...record.sessionIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...record.ownerUserId === undefined ? {} : { ownerUserId: record.ownerUserId },
  }
}

/**
 * Whether one Workspace belongs on a viewer-scoped follow stream.
 * Matches `workspaceRegistry.list(ownerUserId)`: authenticated viewers see only
 * their own rows; unowned rows stay single-user / unauthenticated.
 * @param ownerUserId - Workspace owner stamped at create, if any.
 * @param viewerUserId - authenticated follower, or undefined in single-user mode.
 * @returns whether the Workspace may appear on that follower's stream.
 */
function workspaceVisibleToViewer(
  ownerUserId: string | undefined,
  viewerUserId: string | undefined,
): boolean {
  if (viewerUserId === undefined) return true
  return ownerUserId === viewerUserId
}

/** Owns Workspace domain observation and all active follow generations. */
export class WorkspaceFeed {
  private readonly followers = new Set<WorkspaceFollower>()
  /** Every registered Workspace id, not scoped to one viewer (drives change detection). */
  private knownIds: Set<string>
  /** Owner stamped on each known Workspace; retained until remove so deletes can be filtered. */
  private readonly owners = new Map<string, string | undefined>()
  private order: readonly string[]
  private archived: readonly string[]

  /** @param ctx - Host context containing the authoritative Workspace registry. */
  constructor(private readonly ctx: Context) {
    // Internal tracking must observe the full registry; per-viewer filtering
    // happens at baseline() / publish time from the follower's principal.
    const all = ctx.workspaceRegistry.list()
    this.knownIds = new Set(all.map(workspace => String(workspace.id)))
    for (const workspace of all) this.owners.set(String(workspace.id), workspace.ownerUserId)
    this.order = all.map(workspace => String(workspace.id))
    this.archived = ctx.workspaceRegistry.archivedSessionIds.map(String)
    ctx.on('domain/changed', (change: DomainChanged) => { this.changed(change) })
    ctx.effect(() => () => {
      for (const follower of this.followers) follower.close()
      this.followers.clear()
    }, 'workspace-controller.feed')
  }

  /**
   * Read the complete current projection synchronously.
   * @returns all active Workspaces and archived Session identities.
   */
  baseline(): WorkspaceBaseline {
    const ownerUserId = getPrincipal(this.ctx)?.userId
    return {
      items: this.ctx.workspaceRegistry.list(ownerUserId).map(workspaceView),
      archivedSessionIds: archivedSessionIdsForViewer(this.ctx, ownerUserId),
    }
  }

  /**
   * Open one generation beginning with a complete baseline.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  async *follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    signal.throwIfAborted()
    // Optional multi-user hook: create the caller's default Workspace before the
    // baseline so the first frame already includes it. Failure must not block
    // follow — an empty baseline remains valid when provision cannot run.
    try {
      await this.ctx.get('defaultWorkspaceProvisioner')?.provision()
    } catch (_defaultWorkspaceProvisionFailure) {
      // Best-effort provision; the stream still delivers the current registry.
    }
    // Capture the viewer for this generation: ALS is request-scoped on mux pulls.
    const follower = new WorkspaceFollower(getPrincipal(this.ctx)?.userId)
    this.followers.add(follower)
    try {
      const baseline = this.baseline()
      follower.noteOrder(baseline.items.map(item => String(item.workspaceId)))
      follower.noteArchived(baseline.archivedSessionIds.map(String))
      yield { type: 'baseline', value: baseline }
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  private changed(change: DomainChanged): void {
    if (change.domain !== 'workspace') return
    if (change.table === '') {
      if (change.operation !== 'put') return
      const state = workspaceDomainState.parse(change.value)
      const nextOrder = state.workspaceIds.map(String)
      const orderChanged = !sameStrings(this.order, nextOrder)
      for (const id of state.workspaceIds) {
        if (this.knownIds.has(id)) continue
        const workspace = this.ctx.workspaceRegistry.get(id)
        if (workspace === undefined) {
          throw new Error(`committed Workspace registry references missing Workspace "${id}"`)
        }
        this.knownIds.add(id)
        this.owners.set(id, workspace.ownerUserId)
        this.publish({ type: 'upsert', workspace: workspaceView(workspace) })
      }
      this.order = nextOrder
      if (orderChanged) this.publish({ type: 'order', workspaceIds: [...state.workspaceIds] })
      const nextArchived = state.archivedSessionIds.map(String)
      if (!sameStrings(this.archived, nextArchived)) {
        this.archived = nextArchived
        this.publish({ type: 'archived', archivedSessionIds: [...state.archivedSessionIds] })
      }
      return
    }
    if (change.table !== 'workspaces') return
    if (change.operation === 'deleted') {
      if (!this.knownIds.has(change.key)) return
      const ownerUserId = this.owners.get(change.key)
      this.knownIds.delete(change.key)
      this.owners.delete(change.key)
      this.publish(
        { type: 'remove', workspaceId: WorkspaceId(change.key) },
        ownerUserId,
      )
      return
    }
    if (!this.knownIds.has(change.key)) return
    const view = changedWorkspaceView(change.key, change.value)
    this.owners.set(change.key, view.ownerUserId)
    this.publish({ type: 'upsert', workspace: view })
  }

  /**
   * Fan out one increment to followers whose viewer may observe it.
   * @param frame - committed increment.
   * @param removeOwnerUserId - owner captured before a remove clears {@link owners}.
   */
  private publish(
    frame: WorkspaceFollowIncrement,
    removeOwnerUserId?: string,
  ): void {
    for (const follower of this.followers) {
      const projected = this.projectForFollower(follower, frame, removeOwnerUserId)
      if (projected !== undefined) follower.push(projected)
    }
  }

  /**
   * Project one increment for one follower, or skip it.
   * @param follower - active generation.
   * @param frame - committed increment.
   * @param removeOwnerUserId - owner for remove frames.
   * @returns the frame to push, or undefined when the viewer must not see it.
   */
  private projectForFollower(
    follower: WorkspaceFollower,
    frame: WorkspaceFollowIncrement,
    removeOwnerUserId?: string,
  ): WorkspaceFollowIncrement | undefined {
    const viewerUserId = follower.viewerUserId
    switch (frame.type) {
      case 'upsert':
        return workspaceVisibleToViewer(frame.workspace.ownerUserId, viewerUserId)
          ? frame
          : undefined
      case 'remove':
        return workspaceVisibleToViewer(removeOwnerUserId, viewerUserId) ? frame : undefined
      case 'order': {
        const workspaceIds = viewerUserId === undefined
          ? frame.workspaceIds
          : frame.workspaceIds.filter(id =>
            workspaceVisibleToViewer(this.owners.get(String(id)), viewerUserId))
        if (follower.orderUnchanged(workspaceIds)) return undefined
        follower.noteOrder(workspaceIds.map(String))
        return { type: 'order', workspaceIds }
      }
      case 'archived': {
        // Filter the committed frame — registry archivedSessionIds may still be
        // stale while domain/changed is delivering this put.
        const archivedSessionIds = viewerUserId === undefined
          ? frame.archivedSessionIds
          : frame.archivedSessionIds.filter(id => sessionOwnerUserId(this.ctx, id) === viewerUserId)
        if (follower.archivedUnchanged(archivedSessionIds)) return undefined
        follower.noteArchived(archivedSessionIds.map(String))
        return { type: 'archived', archivedSessionIds }
      }
      default: {
        const _exhaustive: never = frame
        return _exhaustive
      }
    }
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

class WorkspaceFollower {
  private readonly frames = new Deque<WorkspaceFollowFrame>()
  private waiting: (() => void) | undefined
  private closed = false
  private order: readonly string[] = []
  private archived: readonly string[] = []

  /**
   * @param viewerUserId - authenticated user for this generation, or undefined
   *   when multi-user auth is not composed / no principal is bound.
   */
  constructor(readonly viewerUserId: string | undefined) {}

  /**
   * Record the Workspace order last delivered on this generation.
   * @param workspaceIds - order as last sent in baseline or an order frame.
   */
  noteOrder(workspaceIds: readonly string[]): void {
    this.order = [...workspaceIds]
  }

  /**
   * Record the archived Session set last delivered on this generation.
   * @param sessionIds - archive set as last sent in baseline or an archived frame.
   */
  noteArchived(sessionIds: readonly string[]): void {
    this.archived = [...sessionIds]
  }

  /**
   * Whether a projected order matches the last delivered order.
   * @param workspaceIds - candidate order for this viewer.
   * @returns true when the follower should skip the frame.
   */
  orderUnchanged(workspaceIds: readonly WorkspaceId[]): boolean {
    return sameStrings(this.order, workspaceIds.map(String))
  }

  /**
   * Whether a projected archive set matches the last delivered set.
   * @param sessionIds - candidate archive set for this viewer.
   * @returns true when the follower should skip the frame.
   */
  archivedUnchanged(sessionIds: readonly SessionId[]): boolean {
    return sameStrings(this.archived, sessionIds.map(String))
  }

  push(frame: WorkspaceFollowFrame): void {
    /* v8 ignore next -- closed followers are removed before later publication can reach them. */
    if (this.closed) return
    this.frames.pushBack(frame)
    this.waiting?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  async *read(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    while (!this.closed && !signal.aborted) {
      const frame = this.frames.popFront()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await this.wait(signal)
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', finish)
        /* v8 ignore next -- one read owns the sole installed wait callback. */
        if (this.waiting === finish) this.waiting = undefined
        resolve()
      }
      this.waiting = finish
      signal.addEventListener('abort', finish, { once: true })
      /* v8 ignore next -- native signals and the private queue cannot change during this synchronous setup. */
      if (signal.aborted || this.closed || this.frames.size > 0) finish()
    })
  }
}
