# Agent Note: Multi-user default Workspace provision

Status: implemented

English | [中文](2026-09-03-multi-user-default-workspace-provision.zh.md)

## Problem

Department multi-user Web deployments ([same-process multi-tenant](../architecture/2026-08-27-same-process-multi-tenant.md)) require every Session to sit under a Workspace so the composer can open, yet the product still expected each user to browse the host filesystem and create a Workspace by hand. Remote users cannot meaningfully pick a project directory on the shared server, and an empty Workspace list left the UI blocked after login.

## Decision

When the `dsh-multi-user` bundle is composed, Host auto-provisions one default Workspace per authenticated user:

1. **Path.** `$DSH_HOME/workspaces/<userId>/default/` (created with `mkdir` recursive). The path stays under the same root [`dsh-user-path-policy`](../../../../packages/sandbox/user-path-policy/README.md) already confines tool absolute paths to.
2. **Trigger.** `workspace.follow` calls an optional `ctx.defaultWorkspaceProvisioner.provision()` hook before emitting the baseline, so the first frame already includes the new row when the user had none. Plugin `apply` alone cannot read the JWT principal (ALS is request-scoped).
3. **Idempotence.** Provision no-ops without a principal, no-ops when `workspaceRegistry.list(userId)` is non-empty, and relies on path-unique `workspaceRegistry.create` when racing.
4. **Failure.** Provision errors are swallowed at the follow entry so an empty baseline still streams; auto-create is best-effort relative to listing.
5. **UI.** Existing `ui-workspace` navigation already connects the most recent Workspace when the list is non-empty, so no Client change is required for login-to-composer.

The hook interface lives in `@deepseek-ai/dsh-api-workspace-controller` (`DefaultWorkspaceProvisioner`); the implementation is the Cordis entry of `@deepseek-ai/dsh-multi-user`. Single-user compositions omit the service and keep manual directory picking.

## Consequences

- Authenticated multi-user logins reach a usable Session without browsing the host disk.
- Display title defaults to the basename `default` (registry create without an explicit title).
- Directory-picker add-workspace remains available for additional projects under the user root.
- Does not provide strong sandbox isolation; it only establishes the per-user working directory convention.

## Alternatives considered

- **Client-side create when the list is empty** — fewer Host changes, but depends on UI boot order and duplicates provision across clients.
- **`$DSH_HOME/workspaces/<userId>/` as the Workspace path** — collapses the user root with the project directory and leaves no room for sibling project folders under the path-policy root.
- **Provision at process boot for every known user** — no principal at boot; would require a user catalog the Host does not own.
