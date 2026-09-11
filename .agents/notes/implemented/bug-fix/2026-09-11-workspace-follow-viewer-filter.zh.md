# Agent Note: Workspace follow 增量按 viewer 过滤

Status: implemented

[English](2026-09-11-workspace-follow-viewer-filter.md) | 中文

## Problem

多用户下 `workspace.follow` 的 baseline 已调用 `workspaceRegistry.list(ownerUserId)`，但 `WorkspaceFeed.publish` 仍把每个 `upsert` / `remove` / `order` 增量推给全部活跃 follower。用户 A 创建 Session（或 Workspace）并提交 registry 后，用户 B 的 WebSocket `workspace.follow` 会收到 A 的 Workspace 的 `"type":"upsert"`，其中含外来 `sessionIds` 与路径。Gateway `$events` 的 `targetUserId` 打标覆盖不到这条专用 Remote 流。

## Decision

**把每一代 follow 绑定到其 viewer，并过滤增量。** 打开 follower 时捕获 `getPrincipal()?.userId`。仅当 Workspace 所有者与该 viewer 匹配时扇出 `upsert` / `remove`（规则与 `list(ownerUserId)` 相同）。把 `order` 帧投影为该 viewer 可见 id 子集。从已提交的增量投影 `archived` 帧（不要在 `domain/changed` 内重读可能仍过期的 live registry），只保留 live header 或 Workspace 成员关系可归到该 viewer 的 Session id；baseline 与一元归档回声使用同一过滤；投影集合未变则跳过推送。维护 feed 本地 owner 映射，以便在 registry 行删除后仍能过滤 remove。

## Alternatives considered

**每用户一个 WorkspaceFeed 实例** — 拒绝：会重复 domain 观测；共享 feed 加 per-follower 投影即可。

**依赖 Client UI 忽略外来 upsert** — 拒绝：外来 Workspace 路径与 Session id 仍会过线。

## Consequences

已鉴权多用户 Client 不再通过 `workspace.follow` 观察到其他用户的 Workspace upsert/remove/order 帧或外来归档 Session id。单用户 follower（无主体）仍接收未过滤流。用户 A 下创建 Session 不再在用户 B 的 mux 流上产生跨租户 `upsert`。
