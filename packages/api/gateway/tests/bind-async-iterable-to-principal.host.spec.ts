/**
 * Unit tests for ALS rebind on multiplexed Remote stream pulls.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, expect, it } from 'vitest'
import { UserId, type AuthenticatedPrincipal } from '@deepseek-ai/dsh-host-auth-middleware'
import {
  bindAsyncIterableToPrincipal,
  type PrincipalRunner,
} from '../src/bind-async-iterable-to-principal.ts'

function alsAuth(): PrincipalRunner & { readonly read: () => string | undefined } {
  const als = new AsyncLocalStorage<AuthenticatedPrincipal>()
  return {
    runWithPrincipal: (principal, fn) => als.run(principal, fn),
    read: () => als.getStore()?.userId,
  }
}

describe('bindAsyncIterableToPrincipal', () => {
  it('restores the principal for each async generator pull', async () => {
    const auth = alsAuth()
    const principal = { userId: UserId('alice') }
    const source = (async function* () {
      yield auth.read() ?? 'none'
      yield auth.read() ?? 'none'
    })()

    expect(auth.read()).toBeUndefined()
    const values = []
    for await (const value of bindAsyncIterableToPrincipal(auth, principal, source)) {
      values.push(value)
      expect(auth.read()).toBeUndefined()
    }
    expect(values).toEqual(['alice', 'alice'])
  })

  it('restores the principal when return closes the iterator', async () => {
    const auth = alsAuth()
    const principal = { userId: UserId('bob') }
    let closedAs: string | undefined
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: false as const, value: 'item' }),
          return: async () => {
            closedAs = auth.read()
            return { done: true as const, value: undefined }
          },
        }
      },
    }

    const iterator = bindAsyncIterableToPrincipal(auth, principal, source)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'item' })
    await iterator.return?.()
    expect(closedAs).toBe('bob')
  })
})
