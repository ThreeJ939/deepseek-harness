# @deepseek-ai/dsh-session-persistence-pg

[English](README.md) | 中文

可选的 PostgreSQL `SessionPersistence` 提供者。将会话事件存为 JSONB 行，并通过 `create`/`open` 返回的 `SessionHandle` 对外服务。官方单用户配置仍用 JSONL；多用户包仍用 SQLite；[`dsh-platform`](../../bundle/platform/README.zh.md) 覆盖层通过 `DATABASE_URL` 挂载本包。

所有会话共享同一个 PostgreSQL 数据库。进程内写所有权与 SQLite 相同；打开数据库时会尽力清除 `pg_stat_activity` 中已不存在的 `owner_pid` 所对应的陈旧 `is_owned` 标记。

## 存储模型

Schema 2 使用三张表：`persistence_state`（存储身份与 schema 版本）、`sessions`（不可变头字段、revision、所有权标记）、`events`（以 `session_id, seq` 为键的物理行，`data` 为 JSONB）。TEXT 列 `surface_op` 存储 JSON（`"append"` 或 replace 对象），与 SQLite 一致；读取端仍接受遗留的裸 `append` 字面量。追加在显式事务中完成：拒绝非连续的首个逻辑 seq，插入本批，revision 加一。正常追加从不删除或改写更早的行。

与 SQLite 提供者相同，连续同块、长度 ≥ 3 的 `assistant/chunk` delta 跑会打包成一条物理行（`text-chunks` / `reasoning-chunks` / `tool-call-chunks`，并以 `ignorable = FALSE` 标记）。恢复时将 pack 行展开为原始逻辑事件；物理编码不会进入提示、工具、回放或 live `session/event`。

## 配置（schemastery）

```ts
interface Config {
  connectionString: string
  poolSize?: number
}
```

`poolSize` 默认为 `10`。SQLite 提供者那套路径与文件权限检查不适用；数据库须已可达，且凭据须能在首次打开时创建 schema 表。

## Model Experience

### Resumed conversation history

#### What the model sees

与 PostgreSQL 无关。恢复还原的逻辑事件与派生消息与 JSONL 或 SQLite 相同；物理存储列不会进入提示、工具、回放或 live `session/event`。

#### Token effect

零实时请求 token。恢复只为保留的逻辑历史与当前请求信封付费。

#### KV Cache effect

物理存储不改变请求前缀。提供者缓存复用取决于重建历史、当前信封与模型路由，与其它持久化后端相同。

不发布不变式伴生入口，因为 PostgreSQL 持久性与所有权只能通过后端往返测试观测；本包不暴露可持续观测的进程内关系。

## Known Limitations and Deferred Work

- **进程内写所有权** — 超出陈旧 `owner_pid` 清理之外的跨进程单写者 fencing 留给后续租约层（见平台架构 Option A → L3）。
- **无 schema 迁移** — `schema_version` 不匹配时在打开时拒绝；预发布阶段应重建而非迁移。
- **需要可达的 PostgreSQL** — 缺少或无法连接 `DATABASE_URL` 时冷启动会大声失败。
