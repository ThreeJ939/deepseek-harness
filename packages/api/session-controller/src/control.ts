/** Live Session queue, jobs, and projection state with reconnect baselines. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, InboxState } from '@deepseek-ai/dsh-agent'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type {
  Session, SessionId, UserMessage,
} from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  SessionControlBaseline,
  SessionControlFrame,
  SessionJob,
  SessionProjectionBaseline,
  SessionProjectionValues,
  SessionQueuedItem,
} from './types.ts'

/** Owns the Host-wide Session control stream. */
export class SessionControlController {
  private readonly streams = new Set<ControlQueue>()

  /** @param ctx - Host context carrying live Agent, projection, and jobs services. */
  constructor(private readonly ctx: Context) {
    ctx.sessionProjections.onChanged((session, key, value, seq) => {
      this.broadcast({
        type: 'projection',
        sessionId: session.id,
        key,
        value: value as JsonValue,
        seq,
      })
      if (key !== 'inbox') return
      const agent = this.ctx.agents.get(session.id)
      if (agent?.session !== session) return
      this.broadcast({
        type: 'queue',
        sessionId: session.id,
        items: queueItemsFromInbox(value as InboxState),
      })
    })
    ctx.inject(['jobs'], (jobsCtx) => {
      jobsCtx.jobs.onJobsChanged((owner) => { this.onJobsChanged(owner) })
    })
    ctx.on('session/created', (session) => {
      const jobs = this.jobsFor(this.ctx.agents.get(session.id))
      if (jobs.length > 0) this.broadcast({ type: 'jobs', sessionId: session.id, jobs })
    })
    ctx.effect(() => () => {
      for (const stream of this.streams) stream.end()
      this.streams.clear()
    }, 'session-controller.control')
  }

  /**
   * Open one generation of live Session control state.
   * @param signal - Remote stream cancellation.
   * @param viewerUserId - when set, baseline and live frames exclude other users' Sessions.
   * @returns one complete baseline followed by live replacement frames.
   */
  async *control(signal: AbortSignal, viewerUserId?: string): AsyncIterable<SessionControlFrame> {
    signal.throwIfAborted()
    const queue = new ControlQueue(viewerUserId)
    this.streams.add(queue)
    try {
      yield { type: 'baseline', value: this.baseline(viewerUserId) }
      yield* queue.iterate(signal)
    } finally {
      this.streams.delete(queue)
      queue.end()
    }
  }

  private baseline(viewerUserId?: string): SessionControlBaseline {
    const sessions = visibleSessions(this.ctx, viewerUserId)
    const queues = Object.create(null) as Record<SessionId, readonly SessionQueuedItem[]>
    const jobs = Object.create(null) as Record<SessionId, readonly SessionJob[]>
    for (const session of sessions) {
      const agent = this.ctx.agents.get(session.id)
      queues[session.id] = agent?.session === session ? queueItems(agent) : []
      jobs[session.id] = this.jobsFor(agent)
    }
    return {
      queues,
      jobs,
      projections: this.projectionBaseline(sessions),
    }
  }

  private projectionBaseline(
    sessions: readonly Session[],
  ): Readonly<Record<SessionId, SessionProjectionBaseline>> {
    const blocks = Object.create(null) as Record<SessionId, SessionProjectionBaseline>
    for (const session of sessions) {
      const snapshot = this.ctx.sessionProjections.snapshot(session)
      blocks[session.id] = {
        asOfSeq: snapshot.asOfSeq,
        // Every projection definition validates its value before snapshot publication.
        values: snapshot.values as SessionProjectionValues,
      }
    }
    return blocks
  }

  private onJobsChanged(owner: Agent | undefined): void {
    if (owner !== undefined) {
      this.broadcast({ type: 'jobs', sessionId: owner.id, jobs: this.jobsFor(owner) })
      return
    }
    for (const session of this.ctx.sessions.list()) {
      this.broadcast({
        type: 'jobs',
        sessionId: session.id,
        jobs: this.jobsFor(this.ctx.agents.get(session.id)),
      })
    }
  }

  private jobsFor(agent: Agent | undefined): SessionJob[] {
    const jobs = this.ctx.get('jobs')
    return jobs === undefined ? [] : jobs.list(agent).map(jobView)
  }

  private broadcast(frame: SessionControlFrame): void {
    for (const stream of this.streams) {
      if (!frameVisibleToViewer(this.ctx, frame, stream.viewerUserId)) continue
      stream.push(frame)
    }
  }
}

class ControlQueue {
  private readonly buffer = new Deque<SessionControlFrame>()
  private wake: (() => void) | undefined
  private done = false

  /** @param viewerUserId - authenticated viewer; undefined accepts every Session. */
  constructor(readonly viewerUserId: string | undefined) {}

  push(frame: SessionControlFrame): void {
    if (this.done) return
    this.buffer.pushBack(frame)
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  end(): void {
    if (this.done) return
    this.done = true
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  async *iterate(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!this.done && !signal.aborted) {
        const frame = this.buffer.popFront()
        if (frame !== undefined) {
          yield frame
          continue
        }
        await new Promise<void>((resolve) => { this.wake = resolve })
      }
      while (this.buffer.size > 0 && !signal.aborted) yield this.buffer.popFront() as SessionControlFrame
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.end()
    }
  }
}

/**
 * Whether one Session is visible on a viewer-scoped control stream.
 * @param session - candidate Session.
 * @param viewerUserId - authenticated viewer, or undefined in single-user mode.
 * @returns whether the Session belongs on that viewer's control stream.
 */
function sessionVisibleToViewer(session: Session, viewerUserId: string | undefined): boolean {
  if (viewerUserId === undefined) return true
  const owner = session.header.ownerUserId
  return owner === undefined || owner === viewerUserId
}

/**
 * Live Sessions included in one control baseline for the given viewer.
 * @param ctx - Host context carrying the session registry.
 * @param viewerUserId - authenticated viewer, or undefined in single-user mode.
 * @returns Sessions whose control state the viewer may observe.
 */
function visibleSessions(ctx: Context, viewerUserId: string | undefined): Session[] {
  const sessions = ctx.sessions.list()
  if (viewerUserId === undefined) return sessions
  return sessions.filter(session => sessionVisibleToViewer(session, viewerUserId))
}

/**
 * Whether one live control frame may be delivered to a viewer-scoped stream.
 * @param ctx - Host context used to resolve Session ownership on deltas.
 * @param frame - baseline or live replacement frame.
 * @param viewerUserId - authenticated viewer bound to the target stream.
 * @returns whether the frame may be pushed to that stream.
 */
function frameVisibleToViewer(
  ctx: Context,
  frame: SessionControlFrame,
  viewerUserId: string | undefined,
): boolean {
  if (viewerUserId === undefined) return true
  if (frame.type === 'baseline') return true
  const session = ctx.sessions.get(frame.sessionId)
  if (session === undefined) return false
  return sessionVisibleToViewer(session, viewerUserId)
}

function queueItems(agent: Agent): SessionQueuedItem[] {
  return queueItemsFromInbox({
    'next-turn': agent.inbox.nextTurn,
    'next-step': agent.inbox.nextStep,
  })
}

function queueItemsFromInbox(inbox: InboxState): SessionQueuedItem[] {
  return [
    ...inbox['next-turn'].map(message => ({
      id: message.id,
      placement: 'queued' as const,
      ...promptRpcId(message),
      message: { id: message.id, content: message.content as unknown as JsonValue[] },
    })),
    ...inbox['next-step'].map(message => ({
      id: message.id,
      placement: message.source.kind === 'user' ? 'steering' as const : 'context' as const,
      ...promptRpcId(message),
      message: { id: message.id, content: message.content as unknown as JsonValue[] },
    })),
  ]
}

/** Prompt-RPC identity carried by a browser-submitted message's user source. */
function promptRpcId(message: UserMessage): Pick<SessionQueuedItem, 'rpcId'> {
  const source = message.source
  return source.kind === 'user' && 'rpcId' in source ? { rpcId: source.rpcId } : {}
}

function jobView(job: JobSnapshot): SessionJob {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...(job.detail === undefined ? {} : { detail: job.detail }),
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  }
}
