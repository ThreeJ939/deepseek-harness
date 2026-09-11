/**
 * Optional Host hook that ensures an authenticated caller has a Workspace
 * before `workspace.follow` emits its baseline. Multi-user compositions may
 * provide an implementation; single-user deployments leave the service absent.
 * @module @deepseek-ai/dsh-api-workspace-controller/src/default-workspace-provisioner
 */

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional default-Workspace provisioner. Absent when the composition does
     * not auto-create per-user Workspaces.
     */
    defaultWorkspaceProvisioner: DefaultWorkspaceProvisioner
  }
}

/**
 * Ensures the authenticated caller has at least one Workspace.
 * Implementations must be idempotent and must no-op when no principal is
 * present (single-user deployments).
 */
export interface DefaultWorkspaceProvisioner {
  /**
   * Create the caller's default Workspace when they currently have none.
   * @returns resolution after any create attempt settles.
   */
  provision(): Promise<void>
}
