/**
 * Multi-user default Workspace provisioner: on authenticated `workspace.follow`,
 * ensures `$DSH_HOME/workspaces/<userId>/default/` exists and is registered.
 * @module @deepseek-ai/dsh-multi-user/src/default-workspace
 */

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { DefaultWorkspaceProvisioner } from '@deepseek-ai/dsh-api-workspace-controller'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-auth-middleware'
import type {} from '@deepseek-ai/dsh-workspace'

/** Plugin configuration. */
export interface Config {
  /** Harness home used to resolve the per-user default Workspace path. */
  dshHome?: string
}

/** Cordis plugin name. */
export const name = 'default-workspace'

/** Required before the provisioner can register Workspaces. */
export const inject = ['workspaceRegistry']

export const Config: z<Config> = z.object({
  dshHome: z.string(),
})

/**
 * Resolve the canonical default Workspace directory for one user.
 * @param home - resolved Harness home.
 * @param userId - authenticated principal id.
 * @returns absolute path `$HOME/workspaces/<userId>/default`.
 */
export function defaultWorkspacePath(home: string, userId: string): string {
  return resolve(home, 'workspaces', userId, 'default')
}

/**
 * Provide {@link DefaultWorkspaceProvisioner} for `workspace.follow`.
 * @param ctx - Host context with the Workspace registry.
 * @param config - optional harness-home override.
 */
export function apply(ctx: Context, config?: Config): void {
  const home = resolveDshHome(config?.dshHome)
  const provisioner: DefaultWorkspaceProvisioner = {
    async provision(): Promise<void> {
      const principal = ctx.get('authMiddleware')?.getCurrentPrincipal()
      if (principal === undefined) return
      if (ctx.workspaceRegistry.list(principal.userId).length > 0) return
      const path = defaultWorkspacePath(home, principal.userId)
      await mkdir(path, { recursive: true })
      await ctx.workspaceRegistry.create(path, undefined, principal.userId)
    },
  }
  ctx.provide('defaultWorkspaceProvisioner', provisioner)
}
