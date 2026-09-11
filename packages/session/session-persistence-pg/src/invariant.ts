/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-persistence-pg`.
 * @module @deepseek-ai/dsh-session-persistence-pg/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-persistence-pg'

/** Cordis companion plugin name. */
export const name = 'session-persistence-pg-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: PostgreSQL durability and ownership are observable only
 * through store round-trips, not a continuous in-process relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
