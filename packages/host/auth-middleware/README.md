# @deepseek-ai/dsh-host-auth-middleware

English | [中文](README.zh.md)

JWT authentication middleware for the DeepSeek Harness web host. On activation it registers a pre-route `WebMiddleware` on `ctx.webServer` that requires `Authorization: Bearer <token>`, verifies HS256 with `jose`, stores an `AuthenticatedPrincipal` (`userId` from JWT `sub`) in AsyncLocalStorage, and answers `401` when the token is missing or invalid. Downstream code reads the principal via `ctx.authMiddleware.getCurrentPrincipal()`. WebSocket upgrades authenticate through `authenticateRequest` + `runWithPrincipal` (used by `dsh-client-connection`).

## Config

- `jwtSecret` — HMAC secret (min 32 characters). Falls back to `DSH_JWT_SECRET` when omitted.
- `audience` / `issuer` — optional JWT claim checks.

Compose with the [`dsh-multi-user`](../../bundle/multi-user/README.md) bundle. Single-user profiles omit this plugin; gateway ownership checks stay inactive when no principal is present.

## Model Experience

None; this package only authenticates HTTP and upgrade requests.

## Known Limitations and Deferred Work

- **HS256 only** — asymmetric or multi-issuer setups need a follow-on provider.
- **No refresh / session cookies** — callers must supply a Bearer token on every HTTP and upgrade request.
