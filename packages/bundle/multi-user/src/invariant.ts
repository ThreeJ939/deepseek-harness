/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-multi-user`.
 * @module @deepseek-ai/dsh-multi-user/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-multi-user'

/** Cordis companion plugin name. */
export const name = 'multi-user-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the default-Workspace provisioner is request-scoped
 * (authenticated follow) and has no durable event/data relationship to cross-check;
 * auth and path-policy plugins own their own companions.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
