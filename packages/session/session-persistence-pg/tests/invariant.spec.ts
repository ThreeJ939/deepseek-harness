import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as Invariant from '../src/invariant.ts'

describe('session-persistence-pg invariant', () => {
  it('registers an empty companion', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants)
    await ctx.plugin(Invariant)
    expect(Invariant.name).toBe('session-persistence-pg-invariant')
    expect(Invariant.inject).toEqual(['invariants'])
    await ctx.fiber.dispose()
  })
})
