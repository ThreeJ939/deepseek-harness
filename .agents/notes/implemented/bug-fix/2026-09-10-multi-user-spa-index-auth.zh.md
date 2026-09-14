# Agent Note: 多用户 SPA 无需 process-token cookie 即可提供

Status: implemented

[English](2026-09-10-multi-user-spa-index-auth.md) | 中文

## Problem

[同进程多租户](../architecture/2026-08-27-same-process-multi-tenant.zh.md)要求：组合 `auth-middleware` 时 Connection 在没有 process-token cookie 的情况下仍提供 SPA，以便 `dsh-client-ui-auth` 在尚无 JWT 时展示登录页。Harness 仍对 `/` 一律执行 `BrowserAuth.authorizeIndex`，因此在 `dsh-multi-user` 下打开 `http://127.0.0.1:3080/` 会返回 `dsh web authentication required; reopen the URL printed by dsh web`，直到运维粘贴一次性启动 URL。

## Decision

**让 Host Connection 与多租户鉴权分层对齐。** 在 `HostConnectionService` 中：

1. 存在 `ctx.authMiddleware` 时 `authorizeIndex` 返回 `true`，首页无需 launch token 即可加载。
2. `getCurrentPrincipal()` 已绑定（JWT middleware 已成功）时 `requestRejection` 放行；否则仍接受 process cookie，以兼容单用户与本地工具。

`@deepseek-ai/dsh-host-auth-middleware` 仍是 `dsh-client-connection` 的可选 peer，仅用于声明合并。

## Alternatives considered

**多用户 SPA 仍要求 process-token** — 拒绝：共享主机用户不能依赖运维打印的 URL，且架构说明已选择 JWT 登录作为身份门禁。

**存在 middleware 时完全去掉 BrowserAuth** — 已在多租户决策中拒绝；cookie 仍用于单用户组合，以及到达 Connection 时尚无主体的工具路径。

## Consequences

多用户 Web 可打开干净的 loopback 根路径并到达登录页。省略 `authMiddleware` 的单用户 profile 仍使用 launch-token 交换。多用户下 `/api` 仍由 auth-middleware 要求 JWT；一旦主体已绑定，Connection 不再额外要求 browser cookie。
