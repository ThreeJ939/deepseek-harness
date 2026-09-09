# Agent Note: 平台网络存储后端（方案 A）

Status: implemented

[English](2026-09-08-platform-network-storage-backends.md) | 中文

## 问题

同进程多租户 DSH 将会话存本地 SQLite 文件、附件存 `$DSH_HOME/attachments`、工作区/设置域存 `$DSH_HOME/storages`。该布局阻碍跨主机共享持久化、无持久卷的容器重启，以及后续控制面 / 执行面拆分。需要方案 A（外置存储且不拆 Host 进程）的部署，必须实现既有 seam 的网络后端，而不是改写 agent loop。

## 决策

交付三个可选提供者与一个覆盖组合包：

1. `@deepseek-ai/dsh-session-persistence-pg` — PostgreSQL `SessionPersistence`（schema 2），JSONB 事件行，`assistant/chunk` pack 跑与 SQLite 相同，进程内写所有权，并尽力清理陈旧 `owner_pid`。
2. `@deepseek-ai/dsh-attachment-s3` — 兼容 S3 的 `AttachmentStore`，复用本地准入/规范化，内容寻址键位于 `v1/objects/…`。
3. `@deepseek-ai/dsh-storage-pg` — PostgreSQL `StorageBackend`，注册名为 `pg`，供 `dsh-storage-domain` 使用。
4. `@deepseek-ai/dsh-platform` — cordis patch 覆盖层：禁用本地后端，挂载上述三者，并将 `storage-domain.backend` 设为 `pg`。

agent-loop、inbox、`session/event` follow、JWT 鉴权与 Typert remotes 保持不变。写路径仍与 API 同进程。

## 备选方案

- **在网络文件系统上复用 SQLite** — 拒绝：NFS/SMB 上的多写者不安全，且仍绑定共享挂载。
- **延后在 PostgreSQL 中打包 chunk** — 在 schema 2 落地后拒绝：流式回合写入与 SQLite 相同的 packed 物理行；恢复展开为相同逻辑事件且不改 seam。
- **同变更中拆分 API 与 Worker** — 对方案 A 拒绝：那是 L2/L3 工作；存储外置须可独立交付。

## 后果

- Profile 在 multi-user 之后加入 `@deepseek-ai/dsh-platform`，并提供 `DATABASE_URL` 与 `S3_*`。
- S3 的 request-image 变体在读取时重算（尚未桶内缓存）。
- 跨进程独占写者仍依赖后续租约；方案 A 只清理明显失效的 `owner_pid` 标记。
- 已有 schema-1 的 PostgreSQL 库须重建；打开时拒绝不匹配的 `schema_version`。

## 必要验证

- 各提供者的单元测试使用进程内替身（PostgreSQL 用 `pg-mem`，S3 用 mock client）。
- 共享持久化与 KV 后端契约套件（`runPersistenceContract`、`runKvBackendContract`）。
- Pack 往返覆盖：逻辑事件展开，以及 packed delta 跑对应更少的物理 `events` 行。
- 包 README 含 Model Experience 与 Known Limitations；Agent Note 格式门禁。
