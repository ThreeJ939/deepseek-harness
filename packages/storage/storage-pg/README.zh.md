# @deepseek-ai/dsh-storage-pg

[English](README.md) | 中文

面向 storage hub 的 PostgreSQL `StorageBackend`。注册名为 `pg`，提供 `dsh-storage-domain`（工作区等主机域）使用的 KV facet。所有 unit 共用表：`storage_units`、`storage_records`、`storage_globals`。[`dsh-platform`](../../bundle/platform/README.zh.md) 覆盖层挂载本包，并将 `storage-domain` 指向 `backend: pg`。

## 配置（schemastery）

```ts
interface Config {
  connectionString: string
  poolSize?: number
}
```

`poolSize` 默认为 `10`。可与 `dsh-session-persistence-pg` 共用 `DATABASE_URL`，但使用独立连接池。

## Model Experience

### Stored domain records

#### What the model sees

无。本后端不贡献提示、工具或 schema；它只在 `ctx.storage` 之后为宿主侧消费者持久化非会话域数据。

#### Token effect

零实时请求 token。

#### KV Cache effect

无 — 本后端从不触及实时请求前缀。

不发布不变式伴生入口，因为 schema 版本一致性是打开时检查，持久性需要后端往返测试；本包不暴露可持续观测的进程内关系。

## Known Limitations and Deferred Work

- **无 `backupRecord`** — 与 SQLite 后端相同，需要旁路移动的域回滚会失败关闭。
- **无 schema 迁移** — 布局版本不匹配时在打开时拒绝。
- **需要可达的 PostgreSQL** — 连接串缺失或不可达时冷启动会大声失败。
