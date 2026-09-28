/**
 * Core identity types for the auth-middleware package.
 * @module @deepseek-ai/dsh-host-auth-middleware/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * A verified user identity extracted from a JWT `sub` claim. Opaque at
 * runtime; equality is string equality.
 */
export type UserId = Branded<'UserId'>

/**
 * Brand a string as a {@link UserId}.
 * @param id - the raw user id string (typically a JWT `sub` claim).
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function UserId(id: string): UserId {
  return id as UserId
}

/**
 * An authenticated caller extracted from a verified JWT. Present on every
 * request that passed the auth middleware's token check.
 */
export interface AuthenticatedPrincipal {
  /** The verified user identity (JWT `sub` claim). */
  readonly userId: UserId
}
