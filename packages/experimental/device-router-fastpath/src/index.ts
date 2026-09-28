/**
 * Host fast path for device-control turns.
 *
 * On the first step of a human turn it asks yx-agent-router to classify and
 * execute. A claimed success is logged as the original user text plus one
 * plugin notice, and the turn ends without a model call. Every other outcome
 * leaves the pre-step decision unchanged.
 * @module @deepseek-ai/dsh-experimental-device-router-fastpath
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { executeRouter, type DeviceRouterCall } from './client.ts'
import type { DeviceRouterExecution } from './types.ts'

/** Cordis plugin name. */
export const name = 'device-router-fastpath'

/** Plugin config for one mounted router fast path. */
export interface Config {
  /** yx-agent-router origin, without a trailing slash (for example `http://127.0.0.1:18084`). */
  baseUrl: string
  /** Published router id. There is no default: a missing id fails at load. */
  routerId: string
  /** Deadline for the classify-and-execute round trip. Expiry leaves the turn unchanged. */
  timeoutMs: number
  /** Executor ids whose successful result ends the turn. Any other route falls through. */
  claimedExecutors: string[]
  /**
   * Maximum UTF-16 code units of joined human text that still call the router.
   * Longer turns fall through without an HTTP round trip.
   */
  maxMessageChars: number
  /** Extra request headers, such as a gateway token. */
  headers: Record<string, string>
}

/** Runtime schema for {@link Config}. `baseUrl` and `routerId` stay required. */
export const Config: z<Config> = z.object({
  baseUrl: z.string().required(),
  routerId: z.string().required(),
  timeoutMs: z.number().default(3000),
  claimedExecutors: z.array(z.string()).default(['ability-gateway']),
  maxMessageChars: z.number().default(200),
  headers: z.dict(z.string()).default({}),
})

/** Executor account the fast path keeps after a successful claim. */
interface ClaimedExecution {
  route: string
  intent: string
  summary: string
}

/** Transport settings plus the executor allow-list and length gate captured at load. */
interface ResolvedConfig {
  call: DeviceRouterCall
  claimedExecutors: readonly string[]
  maxMessageChars: number
}

/**
 * Install the pre-step fast path.
 * @param ctx - host context. The listener follows agent events from child scopes.
 * @param config - validated router endpoint and claim allow-list.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveCall(config)
  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (payload.step !== 1) return decision
    const humanMessages = decision.messages.filter(message => message.source.kind === 'user')
    const text = humanText(humanMessages)
    if (text === undefined) return decision
    if (text.length > resolved.maxMessageChars) return decision
    const execution = await executeRouter(
      resolved.call,
      text,
      String(payload.agent.session.id),
      payload.signal,
      (line) => { ctx.logger.warn(line) },
    )
    const claimed = claimExecution(resolved.claimedExecutors, execution)
    if (claimed === undefined) return decision
    for (const message of humanMessages) {
      payload.agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
    payload.agent.session.append('user/message', noticeMessage(claimed), { surfaceOp: 'append' })
    return { kind: 'enter', messages: [] }
  })
}

/**
 * Check deployment-varying fields and strip a trailing slash from the origin.
 * @param config - schema-validated plugin config.
 * @returns the transport settings and allow-list used for every execute call.
 */
function resolveCall(config: Config): ResolvedConfig {
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`device-router-fastpath: timeoutMs must be an integer from 1 to ${MAX_TIMER_DELAY_MS}`)
  }
  if (config.claimedExecutors.length === 0 || config.claimedExecutors.some(executor => executor.trim() === '')) {
    throw new Error('device-router-fastpath: claimedExecutors must list at least one non-empty executor id')
  }
  if (!Number.isInteger(config.maxMessageChars) || config.maxMessageChars < 1) {
    throw new Error('device-router-fastpath: maxMessageChars must be an integer >= 1')
  }
  if (!/^[^\\/\s]+$/.test(config.routerId) || config.routerId.includes('..')) {
    throw new Error(`device-router-fastpath: invalid routerId ${JSON.stringify(config.routerId)}`)
  }
  return {
    call: {
      baseUrl: normalizeBaseUrl(config.baseUrl),
      routerId: config.routerId,
      timeoutMs: config.timeoutMs,
      headers: config.headers,
    },
    claimedExecutors: config.claimedExecutors,
    maxMessageChars: config.maxMessageChars,
  }
}

/**
 * Accept only an http(s) origin and drop trailing slashes.
 * @param raw - configured base URL.
 * @returns the origin used to build the execute path.
 */
function normalizeBaseUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch (error: unknown) {
    throw new Error(`device-router-fastpath: invalid baseUrl ${JSON.stringify(raw)} (${String(error)})`, { cause: error })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`device-router-fastpath: baseUrl must be http or https, got ${parsed.protocol}`)
  }
  return raw.replace(/\/+$/, '')
}

/**
 * Join non-empty human text blocks. Image-only and blank turns return `undefined`.
 * @param messages - user-sourced messages from the pre-step decision.
 * @returns the router `message` body, or `undefined` when there is nothing to classify.
 */
function humanText(messages: readonly UserMessage[]): string | undefined {
  const parts: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'text') continue
      if (block.text.trim() === '') continue
      parts.push(block.text)
    }
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/**
 * Accept only a successful allow-listed executor with a known intent.
 * @param claimedExecutors - executor ids allowed to end the turn.
 * @param execution - validated router body, or `undefined` after a transport failure.
 * @returns the account to log, or `undefined` when the turn must fall through.
 */
function claimExecution(
  claimedExecutors: readonly string[],
  execution: DeviceRouterExecution | undefined,
): ClaimedExecution | undefined {
  if (execution === undefined || execution.ok !== true) return undefined
  const route = execution.route
  if (route === undefined || !claimedExecutors.includes(route)) return undefined
  const intent = execution.meta?.intent
  if (intent === undefined || intent === '' || intent === 'unknown') return undefined
  const summary = execution.summary
  const account = summary !== undefined && summary.trim() !== '' ? summary.trim() : intent
  return { route, intent, summary: account }
}

/**
 * One plugin-sourced notice, in the same form as a model-switch notice.
 * @param claimed - successful allow-listed execution.
 * @returns the user-role message appended before the turn ends.
 */
function noticeMessage(claimed: ClaimedExecution): UserMessage {
  const text = boundContextSummary(`[device control: ${claimed.summary}]`)
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'notice',
      summary: text,
    },
  })
}
