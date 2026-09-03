/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-auth-middleware`.
 * @module @deepseek-ai/dsh-host-auth-middleware/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-auth-middleware'

/** Cordis companion plugin name. */
export const name = 'host-auth-middleware-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: authentication is request-scoped ALS state, not a
 * durable registry relationship the companion can probe after fiber teardown.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
