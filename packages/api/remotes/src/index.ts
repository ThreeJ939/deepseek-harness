/** Host BFF entry and Loader shell for the Remote contribution assembly. */

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {
  TypertRemoteEventDispatch,
  TypertRemoteEventFrame,
  TypertRemoteEventInvocation,
  TypertRemoteEventOutcome,
  TypertRemoteEventSource,
} from '@deepseek-ai/dsh-api-gateway'
import { Deque } from '@deepseek-ai/dsh-deque'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

// The owner packages' client-safe `./types` exports carry the cordis `Events`
// declarations for every allowlisted event. Pulling them into this face is what
// makes the shape assertion below judge real signatures rather than an empty
// event vocabulary.
import type {} from '@deepseek-ai/dsh-commands/types'
import type {} from '@deepseek-ai/dsh-cordis-host-runner/types'
import type {} from '@deepseek-ai/dsh-credentials/types'
import type {} from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type {} from '@deepseek-ai/dsh-settings/types'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
export type {} from '@deepseek-ai/dsh-api-session-controller/types'

export { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'
export type { ApiRemoteForwardedEvent } from './types.ts'

/** Required Host service: the Gateway owns the physical Remote stream mux. */
export const inject = ['typertGateway']

/** Host plugin body registering this application's selected Cordis event source. */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() }),
    'api-remotes: forwarded Cordis event source',
  )
}

/** Create the sole queue and listener set consumed by the registered Gateway. */
function remoteEventSource(ctx: Context): TypertRemoteEventSource {
  return (signal) => {
    const queue = new RemoteEventQueue()
    /**
     * Tracks sessionId → ownerUserId for sessions added during this source's
     * lifetime. Used so that 'removed' and activity events can carry the owner
     * even after the session leaves the live registry.
     */
    const sessionOwners = new Map<string, string>()
    const disposers = API_REMOTE_FORWARDED_EVENTS.map(({ event, mode }) => {
      if (mode === 'emit') {
        return ctx.on(event as never, ((...args: unknown[]) => {
          const jsonArgs = assertJsonArgs(event, args)
          // Populate the map before extracting the target so that 'added'
          // events are tagged correctly from the very first emit.
          if (event === 'api-session/added') {
            const summary = jsonArgs[0]
            if (typeof summary === 'object' && summary !== null && !Array.isArray(summary)) {
              const rec = summary as Record<string, JsonValue>
              const sid = rec.sessionId
              const uid = rec.ownerUserId
              if (typeof sid === 'string' && typeof uid === 'string') sessionOwners.set(sid, uid)
            }
          }
          const targetUserId = extractTargetUserId(event, jsonArgs, sessionOwners, ctx)
          // Remove the tracking entry only after the target is determined so
          // the 'removed' event itself is still tagged.
          if (event === 'api-session/removed' && typeof jsonArgs[0] === 'string') {
            sessionOwners.delete(jsonArgs[0])
          }
          const frame = {
            event,
            args: jsonArgs as readonly unknown[],
            ...(targetUserId !== undefined ? { targetUserId } : {}),
          } as TypertRemoteEventFrame
          queue.push(frame)
        }) as never)
      }
      return ctx.on(event as never, (function (
        this: unknown,
        request: object,
        next: () => unknown,
      ) {
        const subject = carrierKeyOf(this)
        if (subject === undefined) return next()
        // Resolve the owning user for the agent carrying this waterfall event.
        const agentId = (subject as { id?: string }).id
        const targetUserId = agentId !== undefined
          ? (sessionOwners.get(agentId) ?? ctx.sessions.get(agentId as unknown as SessionId)?.header.ownerUserId)
          : undefined
        const value = Reflect.get(subject, 'ctx') as unknown
        if (typeof value !== 'object' || value === null) {
          throw new TypeError(`forwarded scoped event ${JSON.stringify(event)} has no live Context`)
        }
        return forwardWaterfall(
          queue,
          event,
          request,
          { value: value as Context, subject },
          next,
          targetUserId,
        )
      }) as never)
    })
    return queue.iterate(signal, () => {
      for (const dispose of disposers) dispose()
    })
  }
}

/** One pull-driven queue bridging synchronous Cordis listeners to an AsyncIterable. */
class RemoteEventQueue {
  private readonly buffer = new Deque<TypertRemoteEventDispatch>()
  private waiter: (() => void) | undefined
  private done = false

  push(frame: TypertRemoteEventDispatch): boolean {
    if (this.done) return false
    this.buffer.pushBack(frame)
    this.waiter?.()
    return true
  }

  private end(reason: unknown): void {
    if (this.done) return
    this.done = true
    while (this.buffer.size > 0) {
      const dispatch = this.buffer.popFront() as TypertRemoteEventDispatch
      if ('context' in dispatch) dispatch.reject(reason)
    }
    this.waiter?.()
  }

  async *iterate(signal: AbortSignal, cleanup: () => void): AsyncGenerator<TypertRemoteEventDispatch> {
    const abort = (): void => { this.end(remoteEventSourceEndReason(signal)) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        if (this.done || signal.aborted) return
        while (this.buffer.size > 0) yield this.buffer.popFront() as TypertRemoteEventDispatch
        await new Promise<void>((resolve) => { this.waiter = resolve })
        this.waiter = undefined
      }
    } finally {
      signal.removeEventListener('abort', abort)
      this.end(remoteEventSourceEndReason(signal))
      cleanup()
    }
  }
}

/**
 * Normalize an event-source shutdown for pending Host waterfalls.
 * @param signal - source lifetime whose reason wins after cancellation.
 * @returns the cancellation reason or an unexpected-end failure.
 */
function remoteEventSourceEndReason(signal: AbortSignal): unknown {
  if (signal.aborted) return signal.reason
  return new Error('api-remotes: forwarded Remote event source ended')
}

/** Bridge one Cordis waterfall listener through the Gateway-owned pending event. */
function forwardWaterfall(
  queue: RemoteEventQueue,
  event: string,
  request: object,
  context: TypertRemoteEventInvocation['context'],
  next: () => unknown,
  targetUserId?: string,
): Promise<unknown> {
  const settled = Promise.withResolvers<unknown>()
  const base: Omit<TypertRemoteEventInvocation, 'targetUserId'> = {
    event,
    request,
    context,
    resolve: (outcome: TypertRemoteEventOutcome) => {
      if (outcome.kind === 'result') {
        settled.resolve(outcome.value)
        return
      }
      void Promise.resolve().then(next).then(settled.resolve, settled.reject)
    },
    reject: settled.reject,
  }
  const dispatch = (targetUserId !== undefined
    ? { ...base, targetUserId }
    : base) as TypertRemoteEventInvocation
  if (!queue.push(dispatch)) void Promise.resolve().then(next).then(settled.resolve, settled.reject)
  return settled.promise
}

/** Reject an allowlisted event whose runtime arguments are not lossless JSON data. */
function assertJsonArgs(event: string, args: readonly unknown[]): JsonValue[] {
  for (const [index, arg] of args.entries()) {
    if (!isJsonValue(arg)) {
      throw new Error(`forwarded host event "${event}" argument ${String(index)} is not lossless JSON data`)
    }
  }
  return args as JsonValue[]
}

/**
 * Extract a per-user delivery target from the event args when the event is
 * owner-scoped. Returns undefined for events broadcast to all clients.
 * @param event - Cordis event name.
 * @param args - validated JSON args for the event.
 * @param sessionOwners - live map of sessionId → ownerUserId for sessions seen
 *   during this source's lifetime; consulted before the live registry.
 * @param ctx - Host Context used to fall back to the live session registry for
 *   sessions that predate this source's startup.
 * @returns the ownerUserId string, or undefined.
 */
function extractTargetUserId(
  event: string,
  args: readonly JsonValue[],
  sessionOwners: ReadonlyMap<string, string>,
  ctx: Context,
): string | undefined {
  switch (event) {
    case 'api-session/added': {
      // ownerUserId is carried directly in the SessionSummary payload.
      const summary = args[0]
      if (typeof summary !== 'object' || summary === null || Array.isArray(summary)) return undefined
      const userId = (summary as Record<string, JsonValue>).ownerUserId
      return typeof userId === 'string' ? userId : undefined
    }
    case 'api-session/removed':
    case 'api-session/status':
    case 'api-session/activity':
    case 'api-session/error':
    case 'agent-preset/selected': {
      // args[0] is the SessionId string for all of these events.
      const sessionId = args[0]
      if (typeof sessionId !== 'string') return undefined
      // Prefer the local map (which captures the removed session before cleanup)
      // and fall back to the live registry for sessions that existed before
      // this source started.
      return sessionOwners.get(sessionId)
        ?? ctx.sessions.get(sessionId as unknown as SessionId)?.header.ownerUserId
    }
    default:
      return undefined
  }
}
