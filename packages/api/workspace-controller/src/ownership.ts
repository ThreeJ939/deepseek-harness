/** Shared multi-tenant ownership helpers for Workspace Host API. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-auth-middleware'
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
