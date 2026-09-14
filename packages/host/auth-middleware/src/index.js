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
import { AsyncLocalStorage } from 'node:async_hooks';
import { createSecretKey } from 'node:crypto';
import { jwtVerify } from 'jose';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { UserId } from "./types.js";
export { UserId };
/**
 * The auth-middleware Cordis service. Registers a pre-route HTTP middleware
 * that verifies JWTs and populates an AsyncLocalStorage context with the
 * authenticated principal. Downstream code reads the current principal via
 * {@link getCurrentPrincipal}.
 */
export class AuthMiddlewareService extends Service {
    static inject = ['webServer'];
    static Config = z.object({
        jwtSecret: z.string(),
        audience: z.string(),
        issuer: z.string(),
    });
    als = new AsyncLocalStorage();
    config;
    secretKey;
    constructor(ctx, config) {
        super(ctx, 'authMiddleware');
        this.config = config;
    }
    /**
     * Return the principal stored in the current async context, or `undefined`
     * when no authenticated request is active (e.g. not called from within a
     * middleware-wrapped handler).
     * @returns the current authenticated principal, or `undefined`.
     */
    getCurrentPrincipal() {
        return this.als.getStore();
    }
    /**
     * Run `fn` with `principal` as the current authenticated identity for the
     * duration of the call (including awaited work). Used by WebSocket pumps
     * that authenticate at upgrade time rather than through the HTTP middleware.
     * @param principal - verified identity to bind.
     * @param fn - work to run under that identity.
     * @returns the return value of `fn`.
     */
    runWithPrincipal(principal, fn) {
        return this.als.run(principal, fn);
    }
    /**
     * Verify the Bearer token on an incoming HTTP or upgrade request.
     * @param req - Node HTTP request carrying an Authorization header.
     * @returns the verified principal, or a failure reason.
     */
    async authenticateRequest(req) {
        const token = extractBearerToken(req);
        if (token === undefined)
            return { ok: false, reason: 'missing-token' };
        try {
            const { payload } = await jwtVerify(token, this.secretKey, {
                algorithms: ['HS256'],
                ...this.config.audience === undefined ? {} : { audience: this.config.audience },
                ...this.config.issuer === undefined ? {} : { issuer: this.config.issuer },
            });
            const sub = payload.sub;
            if (typeof sub !== 'string' || sub.length === 0) {
                return { ok: false, reason: 'missing-subject' };
            }
            return { ok: true, principal: { userId: UserId(sub) } };
        }
        catch {
            return { ok: false, reason: 'invalid-token' };
        }
    }
    async [Service.init]() {
        const secret = this.config.jwtSecret ?? process.env['DSH_JWT_SECRET'];
        if (secret === undefined || secret.length < 32) {
            throw new Error('auth-middleware: jwtSecret must be at least 32 characters '
                + '(set via config.jwtSecret or the DSH_JWT_SECRET environment variable)');
        }
        this.secretKey = createSecretKey(Buffer.from(secret, 'utf8'));
        const middleware = async (req, res, next) => {
            const pathname = new URL(req.url ?? '/', 'http://x').pathname;
            // Login exchange must remain reachable before the browser holds a dsh JWT.
            if (pathname === '/api/auth.exchange')
                return next();
            if (!pathname.startsWith('/api'))
                return next();
            const result = await this.authenticateRequest(req);
            if (!result.ok) {
                const message = result.reason === 'missing-token'
                    ? 'Authorization header is missing or invalid'
                    : result.reason === 'missing-subject'
                        ? 'JWT sub claim is missing or empty'
                        : 'JWT verification failed';
                res.writeHead(401, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'unauthorized', message }));
                return;
            }
            await this.runWithPrincipal(result.principal, next);
        };
        this.ctx.effect(() => this.ctx.webServer.registerMiddleware(middleware), 'authMiddleware: HTTP JWT middleware');
    }
}
/**
 * Extract a Bearer token from an Authorization header or `?access_token=`
 * query parameter. The query fallback supports WebSocket upgrade requests
 * where browsers cannot set custom headers.
 * @param req - incoming HTTP request.
 * @returns the token string, or undefined when absent/malformed.
 */
function extractBearerToken(req) {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        return auth.slice('Bearer '.length).trim() || undefined;
    }
    const qs = new URL(req.url ?? '/', 'http://x').searchParams;
    return qs.get('access_token') ?? undefined;
}
export default AuthMiddlewareService;
//# sourceMappingURL=index.js.map