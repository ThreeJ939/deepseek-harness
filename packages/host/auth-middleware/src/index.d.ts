/**
 * @deepseek-ai/dsh-host-auth-middleware — JWT authentication Cordis plugin for
 * the DeepSeek Harness web host. Registers a {@link WebMiddleware} that
 * validates an `Authorization: Bearer <token>` header (or `?access_token=`
 * query for WebSocket upgrades) on every `/api` request, stores the verified
 * {@link AuthenticatedPrincipal} in an {@link AsyncLocalStorage} context, and
 * returns `401 Unauthorized` for requests that carry no valid token. Non-`/api`
 * paths (static assets, SPA routes, OAuth callbacks) pass through without
 * authentication.
 *
 * Downstream consumers (session/workspace controllers) read the current principal
 * via `ctx.get('authMiddleware')?.getCurrentPrincipal()`. WebSocket upgrades
 * authenticate through {@link AuthMiddlewareService.authenticateRequest} and
 * {@link AuthMiddlewareService.runWithPrincipal}.
 * @module @deepseek-ai/dsh-host-auth-middleware
 */
import type { IncomingMessage } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { UserId, type AuthenticatedPrincipal } from './types.ts'
export { UserId }
export type { AuthenticatedPrincipal }
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** JWT authentication middleware service; absent when not composed. */
    authMiddleware: AuthMiddlewareService
  }
}
/** Plugin configuration. */
export interface Config {
  /**
     * HMAC-SHA256 secret for JWT verification. Read from the environment
     * variable `DSH_JWT_SECRET` when not set explicitly. Must be at least 32
     * characters to prevent trivially weak keys.
     */
  jwtSecret?: string
  /**
     * JWT audience claim to verify; absent means the audience is not checked.
     * Multi-tenant deployments should set this to the application identifier.
     */
  audience?: string
  /**
     * JWT issuer claim to verify; absent means the issuer is not checked.
     */
  issuer?: string
}
/** Why {@link AuthMiddlewareService.authenticateRequest} rejected a request. */
export type AuthFailureReason = 'missing-token' | 'invalid-token' | 'missing-subject'
/**
 * The auth-middleware Cordis service. Registers a pre-route HTTP middleware
 * that verifies JWTs and populates an AsyncLocalStorage context with the
 * authenticated principal. Downstream code reads the current principal via
 * {@link getCurrentPrincipal}.
 */
export declare class AuthMiddlewareService extends Service {
  static inject: string[]
  static Config: z<Config>
  private readonly als
  private readonly config
  private secretKey
  constructor(ctx: Context, config: Config)
  /**
     * Return the principal stored in the current async context, or `undefined`
     * when no authenticated request is active (e.g. not called from within a
     * middleware-wrapped handler).
     * @returns the current authenticated principal, or `undefined`.
     */
  getCurrentPrincipal(): AuthenticatedPrincipal | undefined
  /**
     * Run `fn` with `principal` as the current authenticated identity for the
     * duration of the call (including awaited work). Used by WebSocket pumps
     * that authenticate at upgrade time rather than through the HTTP middleware.
     * @param principal - verified identity to bind.
     * @param fn - work to run under that identity.
     * @returns the return value of `fn`.
     */
  runWithPrincipal<T>(principal: AuthenticatedPrincipal, fn: () => T): T
  /**
     * Verify the Bearer token on an incoming HTTP or upgrade request.
     * @param req - Node HTTP request carrying an Authorization header.
     * @returns the verified principal, or a failure reason.
     */
  authenticateRequest(req: IncomingMessage): Promise<{
    ok: true
    principal: AuthenticatedPrincipal
  } | {
    ok: false
    reason: AuthFailureReason
  }>;
  [Service.init](): Promise<void>
}
export default AuthMiddlewareService
//# sourceMappingURL=index.d.ts.map
