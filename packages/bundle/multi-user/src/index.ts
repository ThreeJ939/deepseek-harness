/**
 * @deepseek-ai/dsh-multi-user — same-process multi-tenant profile bundle.
 * The package mounts JWT auth and path policy through `cordis.patch.yml`, and
 * provides the default-Workspace provisioner loaded as this entry's Cordis plugin.
 * @module @deepseek-ai/dsh-multi-user
 */

export {
  name,
  inject,
  Config,
  apply,
  defaultWorkspacePath,
} from './default-workspace.ts'
export type { Config as DefaultWorkspaceConfig } from './default-workspace.ts'
