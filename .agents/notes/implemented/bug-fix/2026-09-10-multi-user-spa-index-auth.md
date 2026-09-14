# Agent Note: Multi-user SPA serves without process-token cookie

Status: implemented

English | [中文](2026-09-10-multi-user-spa-index-auth.zh.md)

## Problem

[Same-process multi-tenant](../architecture/2026-08-27-same-process-multi-tenant.md) requires Connection to serve the SPA without the process-token cookie when `auth-middleware` is composed, so `dsh-client-ui-auth` can present login before any JWT exists. Harness still always ran `BrowserAuth.authorizeIndex` on `/`, so opening `http://127.0.0.1:3080/` under `dsh-multi-user` returned `dsh web authentication required; reopen the URL printed by dsh web` until the operator pasted the one-shot launch URL.

## Decision

**Align Host Connection with the multi-tenant auth layering.** In `HostConnectionService`:

1. `authorizeIndex` returns `true` when `ctx.authMiddleware` is present, so the index loads without a launch token.
2. `requestRejection` accepts a request when `getCurrentPrincipal()` is already bound (JWT middleware succeeded), and otherwise still accepts the process cookie for single-user and local tooling.

`@deepseek-ai/dsh-host-auth-middleware` remains an optional peer of `dsh-client-connection` for declaration merging only.

## Alternatives considered

**Keep process-token on multi-user SPA** — rejected: shared-host users cannot rely on the operator's printed URL, and the architecture note already chose JWT login as the identity gate.

**Drop BrowserAuth entirely when middleware is present** — rejected earlier in the multi-tenant decision; cookie remains for single-user compositions and tooling paths that reach Connection without a principal.

## Consequences

Multi-user Web can open the clean loopback root and reach the login page. Single-user profiles omit `authMiddleware` and keep the launch-token exchange. `/api` under multi-user still requires JWT via auth-middleware; Connection no longer also demands a browser cookie once a principal is bound.
