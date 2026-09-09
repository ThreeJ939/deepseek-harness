import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import { bundle } from '../src/index.ts'
import * as PlatformInvariant from '../src/invariant.ts'

describe('dsh-platform bundle', () => {
  it('exports the platform bundle marker', () => {
    expect(bundle).toBe('platform')
  })

  it('registers an empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants)
    await ctx.plugin(PlatformInvariant)
    expect(PlatformInvariant.name).toBe('platform-invariant')
    expect(PlatformInvariant.inject).toEqual(['invariants'])
    await ctx.fiber.dispose()
  })
})
