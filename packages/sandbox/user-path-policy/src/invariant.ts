/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-user-path-policy`.
 * @module @deepseek-ai/dsh-user-path-policy/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-user-path-policy'

/** Cordis companion plugin name. */
export const name = 'user-path-policy-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: this plugin only contributes a `tools/pre-execute`
 * waterfall listener whose effect is observed through denial outcomes, not a
 * durable owned relationship between registries.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
