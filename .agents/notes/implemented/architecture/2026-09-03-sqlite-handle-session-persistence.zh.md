# Agent Note: SQLite handle 会话持久化

Status: implemented

[English](2026-09-03-sqlite-handle-session-persistence.md) | 中文

## 问题

Handle 持久化缝（[决策](2026-08-27-handle-based-session-persistence.zh.md)）已替换 coordinator 的 `create`/`append`/`load`。同进程多租户 bundle（[决策](2026-08-27-same-process-multi-tenant.zh.md)）仍需要带 `owner_id` 的单一 SQLite 库，以便已认证用户共享进程而不扫描逐会话 JSONL。把 coordinator 适配器留在 handle 抽象类旁会使仓库无法构建。

## 决策

`@deepseek-ai/dsh-session-persistence-sqlite` 实现五方法 handle 缝：`create`/`open` 返回 `SessionHandle`；`flush`/`stat`/`list` 与 JSONL 一致。Schema 18 与物理存储（`appendBatch`、打包行、`owner_id`）保留。`list` 接受 `ownerUserId`。`header.isSeeded` 为真时，`seed_length` 存放 `inheritedEventCount`。

官方单用户 profile 仍使用 JSONL。多用户 bundle 仍挂载 SQLite 并禁用 JSONL。coordinator 模块已不存在；实时写入与 JSONL 一样经 handle 路由。

因此本树为多用户部署保留可选的第二套权威 Session 格式，而这正是[仅 JSONL 的第一方持久化](../simplification/2026-08-30-jsonl-only-session-persistence.zh.md)为默认产品否决的路径。

## 后果

- 多用户列表在 SQL（`select-sessions-by-owner`）过滤，并包含进程内尚未落盘的会话。
- Schema 17 数据库仍被拒绝；不提供迁移。
- 持久化测试使用 `runPersistenceContract`，不再使用 coordinator 合同。

## 考虑过的替代方案

- **只用 JSONL，再在内存里按 `ownerUserId` 过滤。** 否决：多用户部署需要一个 WAL 库和带索引的所有者查询。
- **仅在 SQLite 后保留 coordinator。** 否决：与 handle 并列的第二套缝会重新引入无主认领，并破坏抽象类。
