/**
 * Re-enter auth ALS while a multiplexed Remote stream iterator is pulled.
 * Upgrade-time runWithPrincipal does not cover later pump next calls.
 * @module @deepseek-ai/dsh-api-gateway/src/bind-async-iterable-to-principal
 */

import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-host-auth-middleware'

/** Minimal auth face needed to restore the upgrade-bound principal on each pull. */
export interface PrincipalRunner {
  /**
   * Run `fn` with `principal` as the current authenticated identity.
   * @param principal - verified identity to bind.
   * @param fn - work to run under that identity.
   * @returns the return value of `fn`.
   */
  runWithPrincipal<T>(principal: AuthenticatedPrincipal, fn: () => T): T
}

/**
 * Wrap `source` so each iterator `next` / `return` / `throw` runs inside
 * {@link PrincipalRunner.runWithPrincipal}. Async generator bodies that read
 * ALS (for example default Workspace provision on `workspace.follow`) therefore
 * see the connection's user after WebSocket upgrade.
 * @param auth - auth middleware (or test double) that owns ALS.
 * @param principal - identity captured at upgrade time.
 * @param source - business stream iterable from Gateway `stream()`.
 * @returns an iterable whose pulls re-enter ALS for `principal`.
 */
export function bindAsyncIterableToPrincipal<T>(
  auth: PrincipalRunner,
  principal: AuthenticatedPrincipal,
  source: AsyncIterable<T>,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const iterator = source[Symbol.asyncIterator]()
      return {
        next: () => auth.runWithPrincipal(principal, () => iterator.next()),
        return: (value?: unknown) => auth.runWithPrincipal(principal, () => {
          if (typeof iterator.return !== 'function') {
            return Promise.resolve({ done: true as const, value: undefined })
          }
          return iterator.return(value)
        }),
        throw: (error?: unknown) => auth.runWithPrincipal(principal, () => {
          if (typeof iterator.throw !== 'function') {
            return Promise.reject(
              error instanceof Error ? error : new Error('iterator throw', { cause: error }),
            )
          }
          return iterator.throw(error)
        }),
      }
    },
  }
}
