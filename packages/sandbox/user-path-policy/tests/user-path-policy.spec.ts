/**
 * Multi-tenant workspace path bound unit tests.
 */
import { describe, expect, it } from 'vitest'
import { collectAbsolutePaths, isPathInside } from '../src/index.ts'

describe('user-path-policy', () => {
  it('accepts paths inside the owner workspace root', () => {
    expect(isPathInside('/home/dsh/workspaces/alice', '/home/dsh/workspaces/alice/proj')).toBe(true)
    expect(isPathInside('/home/dsh/workspaces/alice', '/home/dsh/workspaces/alice')).toBe(true)
  })

  it('rejects paths outside the owner workspace root (cross-user)', () => {
    expect(isPathInside('/home/dsh/workspaces/alice', '/home/dsh/workspaces/bob/proj')).toBe(false)
    expect(isPathInside('/home/dsh/workspaces/alice', '/etc/passwd')).toBe(false)
  })

  it('collects absolute paths from nested tool arguments', () => {
    expect(collectAbsolutePaths({
      path: '/tmp/a',
      nested: { file: 'C:\\Users\\x\\file.txt', relative: 'src/index.ts' },
      list: ['/var/log'],
    }).sort()).toEqual(['/tmp/a', '/var/log', 'C:\\Users\\x\\file.txt'].sort())
  })
})
