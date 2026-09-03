# Agent Note: 同进程多租户所有权

Status: implemented

[English](2026-08-27-same-process-multi-tenant.md) | 中文

## 问题

DeepSeek Harness 原本是单用户本地服务。部门共享进程部署需要在会话、工作区、凭据、设置、事件流与工具文件系统路径上隔离已认证用户，且不为每用户起独立进程或容器。

## 决策

在官方 Host API controllers 之上，以可选 `dsh-multi-user` bundle 交付同进程多租户（不再依赖已拆除的单体 apiproxy）。

1. **认证。** `dsh-host-auth-middleware` 校验 Bearer JWT，ALS 存放主体，并对 `/api`（除 `/api/auth.exchange`）返回 401。`dsh-host-auth-login` 通过 SaaS userinfo 换发 JWT。组合中间件时 Connection 放行 SPA 以便 `ui-auth` 登录；`/api` 仍需 JWT。
2. **会话归属。** 可选 `SessionHeader.ownerUserId`；`session-controller` 在 create 盖戳、过滤 list、拒绝跨用户 resolve。
3. **工作区归属。** 可选 `Workspace.ownerUserId`，由 `workspace-controller` 过滤与校验。
4. **凭据 / 设置。** `readOnly` 与 `userOverlay`；有主体时拒绝凭据写入。
5. **沙箱。** `dsh-user-path-policy` 将绝对路径限制在 `$DSH_HOME/workspaces/<ownerUserId>/`。
6. **默认工作区。** `dsh-multi-user` 提供 `defaultWorkspaceProvisioner`：已鉴权的 `workspace.follow` 在调用方尚无 Workspace 时，mkdir `$DSH_HOME/workspaces/<userId>/default/` 并登记（[provision 决策](../feature/2026-09-03-multi-user-default-workspace-provision.zh.md)）。
7. **Bundle。** 挂载 auth、path policy 与默认工作区 provision，将会话持久化切换为 handle 版 SQLite schema 18（可空 `owner_id`；[SQLite handle](2026-09-03-sqlite-handle-session-persistence.zh.md)）、禁用 JSONL，启用只读凭据与设置叠加；API controllers 同时按 `ownerUserId` 过滤。

## 后果

- 未挂 multi-user bundle 时保持单用户 BrowserAuth。
- WebSocket 升级时校验 JWT；升级后长连接泵不会自动重新进入 ALS。
- 多用户部署需重建 schema 17 的 SQLite 会话库；不提供迁移。

## 备选方案

- **每用户一进程/容器** — 隔离更强但空闲成本高。
- **强制非空 owner** — 破坏单用户与旧日志。
- **仅 API 侧过滤（JSONL）** — 作为单用户默认保留；multi-user bundle 额外挂载 SQLite schema 18 以持久化 `owner_id`。
- **完全替换 BrowserAuth** — 拒绝；JWT 叠加其上。
