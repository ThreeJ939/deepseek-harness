/** Shared multi-tenant ownership helpers for Workspace Host API. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-auth-middleware'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Read the authenticated principal when multi-user auth is composed.
 * @param ctx - host context that may carry `authMiddleware`.
 * @returns the current principal, or undefined in single-user deployments.
 */
export function getPrincipal(ctx: Context) {
  return ctx.get('authMiddleware')?.getCurrentPrincipal()
}

/**
 * Resolve the multi-tenant owner of one Session for archive visibility.
 * Prefer the live header; otherwise attribute by Workspace membership.
 * @param ctx - host context with optional `sessions` and Workspace registry.
 * @param sessionId - Session identity to attribute.
 * @returns owner user id when known, otherwise undefined.
 */
export function sessionOwnerUserId(ctx: Context, sessionId: SessionId): string | undefined {
  const live = ctx.get('sessions')?.get(sessionId)?.header.ownerUserId
  if (live !== undefined) return live
  for (const workspace of ctx.workspaceRegistry.list()) {
    if (!workspace.sessionIds.includes(sessionId)) continue
    if (workspace.ownerUserId !== undefined) return workspace.ownerUserId
  }
  return undefined
}

/**
 * Project the process-global archive set for one viewer.
 * @param ctx - host context containing the Workspace registry.
 * @param viewerUserId - authenticated follower, or undefined in single-user mode.
 * @returns archive Session ids that viewer may observe.
 */
export function archivedSessionIdsForViewer(
  ctx: Context,
  viewerUserId: string | undefined,
): SessionId[] {
  const all = ctx.workspaceRegistry.archivedSessionIds
  if (viewerUserId === undefined) return [...all]
  return all.filter(id => sessionOwnerUserId(ctx, id) === viewerUserId)
}

/**
 * Deny access when an authenticated caller does not own the Workspace.
 * @param ctx - host context.
 * @param ownerUserId - resource owner stamped at create time, if any.
 * @param workspaceId - optional Workspace id for error details.
 * @returns a RemoteError when access is denied, otherwise undefined.
 */
export function workspaceOwnershipDenied(
  ctx: Context,
  ownerUserId: string | undefined,
  workspaceId?: string,
): RemoteError<'workspace/unauthorized'> | undefined {
  const principal = getPrincipal(ctx)
  if (principal === undefined) return undefined
  if (ownerUserId === principal.userId) return undefined
  return new RemoteError(
    'workspace/unauthorized',
    'caller is not authorized to access this workspace',
    workspaceId === undefined ? {} : { workspaceId },
  )
}
