/**
 * Multi-tenant path bound: when a session carries `ownerUserId`, tool
 * arguments that name absolute paths must stay under
 * `$DSH_HOME/workspaces/<ownerUserId>/`. Sessions without an owner (single-user)
 * are unrestricted by this plugin.
 * @module @deepseek-ai/dsh-user-path-policy
 */

import { resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-tools'

/** Plugin config. */
export interface Config {
  /** Harness home used to resolve the per-user workspace root. */
  dshHome?: string
}

export const name = 'user-path-policy'
export const inject = ['tools']

export const Config: z<Config> = z.object({
  dshHome: z.string(),
})

/**
 * Whether `candidate` is equal to or a descendant of `root`.
 * @param root - allowed absolute root.
 * @param candidate - absolute path under test.
 * @returns true when the candidate is inside the root.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  if (normalizedCandidate === normalizedRoot) return true
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`
  return normalizedCandidate.startsWith(prefix)
}

/**
 * Collect string values from tool args that look like absolute filesystem paths.
 * @param value - JSON-compatible tool arguments.
 * @returns absolute path strings found anywhere in the tree.
 */
export function collectAbsolutePaths(value: unknown): string[] {
  const found: string[] = []
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (node.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(node)) found.push(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node === 'object' && node !== null) {
      for (const item of Object.values(node)) visit(item)
    }
  }
  visit(value)
  return found
}

/**
 * Register the multi-tenant path bound on every tool pre-execute.
 * @param ctx - Cordis context with tools.
 * @param config - optional harness-home override.
 */
export function apply(ctx: Context, config?: Config): void {
  const home = resolveDshHome(config?.dshHome)
  ctx.on('tools/pre-execute', async (exec, next) => {
    const ownerUserId = exec.agent?.session.header.ownerUserId
    if (ownerUserId === undefined || ownerUserId.length === 0) return next()
    const allowedRoot = resolve(home, 'workspaces', ownerUserId)
    const paths = collectAbsolutePaths(exec.arguments)
    for (const path of paths) {
      if (!isPathInside(allowedRoot, path)) {
        return {
          kind: 'deny' as const,
          reason: `path "${path}" is outside the caller's workspace root "${allowedRoot}"`,
        }
      }
    }
    return next()
  })
}
