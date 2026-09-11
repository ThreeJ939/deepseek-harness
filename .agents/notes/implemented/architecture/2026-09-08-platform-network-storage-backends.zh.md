# Agent Note: Platform network storage backends (Option A)

Status: implemented

English | [中文](2026-09-08-platform-network-storage-backends.md)

## Problem

同进程多租户 DSH 将会话存在本地 SQLite、附件在 `$DSH_HOME/attachments`、workspace/settings 域在 `$DSH_HOME/storages`。该布局阻碍跨主机共享持久化、无持久卷的容器重启，以及后续控制面 / 执行面拆分。需要 Option A（不拆分 Host 进程的存储外置）时，应实现既有 seam 的网络后端，而不是改写 agent loop。

## Decision

交付三个可选 provider 与一个 overlay bundle：

1. `@deepseek-ai/dsh-session-persistence-pg` — PostgreSQL `SessionPersistence`，JSONB 事件行、进程内写所有权、尽力清理陈旧 `owner_pid`。句柄返回与当前持久化 seam 一致的 `SessionHandleReadResult`（`eventState` + `events`）。
2. `@deepseek-ai/dsh-attachment-s3` — 兼容 S3 的 `AttachmentStore`，复用本地图片准入/归一化（`v1/objects/…`），并实现 verbatim `saveFileStream` / `readFileStream`（`v1/files/…`）。
3. `@deepseek-ai/dsh-storage-pg` — 注册为 `pg` 的 PostgreSQL `StorageBackend`，供 `dsh-storage-domain` 使用。
4. `@deepseek-ai/dsh-platform` — cordis patch 覆盖层：关闭本地后端（`session-persistence-sqlite`、`attachment-local`、`storage-json`），挂载上述三者，并将 `storage-domain.backend` 设为 `pg`。

组合顺序仍为 `base → web-app → multi-user → platform`。Agent-loop、inbox、JWT 鉴权与 Typert remotes 不变。写路径仍与 API 同进程。

## Alternatives considered

- **在网络文件系统上复用 SQLite** — 拒绝：NFS/SMB 上多写 SQLite 不安全，且仍依赖共享挂载。
- **同一切口拆分 API 与 Worker** — Option A 拒绝：属 L2/L3；存储外置须独立交付。
- **原地替换 multi-user 的 SQLite 挂载** — 拒绝：本地多租户继续用 SQLite；仅在叠加 platform 时切换网络后端。

## Consequences

- Profile 在 multi-user 之后添加 `@deepseek-ai/dsh-platform`，并提供 `DATABASE_URL` 与 `S3_*`。
- S3 上的 request-image 变体在读取时重算（尚未做桶缓存）。
- 跨进程独占写仍依赖后续租约；Option A 只清理明显失效的 `owner_pid`。
- `schema_version` 不匹配的既有 PostgreSQL 库在 open 时被拒绝。

## Required verification

- 各 provider 的单元测试（进程内替身：mock pool / mock S3 client）。
- 适用处跑共享持久化与 KV 后端合约套件。
- 包 README 含 Model Experience 与 Known Limitations；通过 Agent Note 格式门禁。
