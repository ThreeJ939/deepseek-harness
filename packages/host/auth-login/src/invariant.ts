/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-auth-login`.
 * @module @deepseek-ai/dsh-host-auth-login/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-auth-login'

/** Cordis companion plugin name. */
export const name = 'host-auth-login-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No durable registry relationship to assert: the exchange endpoint is a
 * stateless HTTP handler registered at plugin init time.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
