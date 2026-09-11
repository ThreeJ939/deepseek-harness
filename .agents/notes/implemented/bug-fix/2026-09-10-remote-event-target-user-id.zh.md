# Agent Note: Remote 事件扇出携带会话所有者 targetUserId

Status: implemented

[English](2026-09-10-remote-event-target-user-id.md) | 中文

## Problem

多用户会话隔离会盖戳 `ownerUserId`、过滤 list/resolve API，并按 `viewerUserId` 过滤 `session.control`（[同进程多租户](../architecture/2026-08-27-same-process-multi-tenant.zh.md)）。API Gateway 已跳过 `targetUserId` 与连接不匹配的 `$events` 帧。Harness 的 `dsh-api-remotes` 仍在转发 Session emit 与作用域 waterfall 时不带 `targetUserId`，因此某一用户的会话实时侧栏与活动更新会广播给所有已登录浏览器。

## Decision

**在 remotes source 为按所有者作用域的转发事件打标。** 维护由 `api-session/added` / `removed` 更新的 `sessionId → ownerUserId` 映射。在 Session 相关 emit（`api-session/*`、`agent-preset/selected`、`goal/activation-changed`）以及 Agent-scoped waterfall 上附带 `targetUserId`（从映射或可选的 live `sessions` 注册表解析）。全局 emit（settings、commands 等）保持不打标，以便所有连接仍能收到。

## Alternatives considered

**仅在 Client UI 过滤** — 拒绝：其他用户仍会在线路上收到外来 Session 元数据。

**要求每个 emit 都走 session-controller Remote 流** — 拒绝：`$events` 已扇出 Cordis 通知；在 allowlist source 打标符合 Gateway 既有约定。

## Consequences

多用户 Client 不再通过 `$events` 观察到其他用户的 Session added/removed/activity 或 goal 激活帧。单用户与未鉴权连接（无连接 `userId`）仍接收每一帧。使 harness remotes 与 multi-user MESSAGE-FLOW 所记录的 deepseek 分支行为对齐。
