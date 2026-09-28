/**
 * One classify-and-execute call to yx-agent-router.
 * Transport failures resolve to `undefined` so the caller can fail open.
 * @module @deepseek-ai/dsh-experimental-device-router-fastpath/client
 */

import z from '@deepseek-ai/schemastery'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { DeviceRouterExecution } from './types.ts'

/** Abort reason code for this plugin's round-trip deadline. */
export const DEVICE_ROUTER_TIMEOUT = 'DEVICE_ROUTER_TIMEOUT'

/** Resolved transport settings for one execute call. */
export interface DeviceRouterCall {
  /** Router origin without a trailing slash. */
  baseUrl: string
  /** Published router id interpolated into the execute path. */
  routerId: string
  /** Round-trip deadline in milliseconds. */
  timeoutMs: number
  /** Extra headers merged after `content-type`. */
  headers: Record<string, string>
}

const ExecutionSchema: z<DeviceRouterExecution> = z.object({
  ok: z.boolean().required(),
  route: z.string(),
  summary: z.string(),
  meta: z.object({
    intent: z.string(),
  }),
})

/**
 * POST `{baseUrl}/router/v1/{routerId}/execute`.
 * A timeout, non-2xx status, or unusable body resolves to `undefined`.
 * Caller cancellation rejects so the turn stays aborted.
 * @param call - resolved router endpoint and deadline.
 * @param message - human text sent as `message`.
 * @param sessionUser - DSH session id sent as `sessionUser`.
 * @param signal - turn cancellation fused into the deadline.
 * @param warn - receives one line for each fail-open transport outcome.
 * @returns the validated execution, or `undefined` when the call is not usable.
 */
export async function executeRouter(
  call: DeviceRouterCall,
  message: string,
  sessionUser: string,
  signal: AbortSignal | undefined,
  warn: (line: string) => void,
): Promise<DeviceRouterExecution | undefined> {
  using timer = deadline(signal, call.timeoutMs, DEVICE_ROUTER_TIMEOUT)
  try {
    const response = await fetch(`${call.baseUrl}/router/v1/${encodeURIComponent(call.routerId)}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...call.headers },
      body: JSON.stringify({ message, sessionUser }),
      signal: timer.signal,
    })
    if (!response.ok) {
      warn(`device-router-fastpath: router HTTP ${response.status}`)
      return undefined
    }
    const payload: unknown = await response.json()
    return ExecutionSchema(payload as DeviceRouterExecution)
  } catch (error: unknown) {
    if (timeoutOf(timer.signal, DEVICE_ROUTER_TIMEOUT)) {
      warn(`device-router-fastpath: router timed out after ${call.timeoutMs}ms`)
      return undefined
    }
    if (signal?.aborted) throw error
    warn(`device-router-fastpath: router response rejected (${String(error)})`)
    return undefined
  }
}
