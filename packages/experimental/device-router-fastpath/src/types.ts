/**
 * Wire fields this plugin reads from yx-agent-router's execute response.
 * Extra JSON fields are ignored. This file is types only.
 * @module @deepseek-ai/dsh-experimental-device-router-fastpath/types
 */

/** Validated subset of `POST /router/v1/{routerId}/execute`. */
export interface DeviceRouterExecution {
  /** Whether the selected executor reported success. */
  ok: boolean
  /** Executor id the router selected, when present. */
  route?: string
  /** Short execution account, when the router supplied one. */
  summary?: string
  /** Classifier metadata. Only `intent` participates in the claim decision. */
  meta?: {
    /** Classifier intent. `unknown` and absence both decline the fast path. */
    intent?: string
  }
}
