import { describe, expect, it } from 'vitest'
import { bundle } from '../src/index.ts'

describe('dsh-platform bundle', () => {
  it('exports the platform bundle marker', () => {
    expect(bundle).toBe('platform')
  })
})
