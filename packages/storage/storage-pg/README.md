# @deepseek-ai/dsh-storage-pg

English | [中文](README.zh.md)

PostgreSQL `StorageBackend` for the storage hub. Registers as backend name `pg` and serves the KV facet used by `dsh-storage-domain` (workspaces and other host domains). Shared tables hold every unit: `storage_units`, `storage_records`, and `storage_globals`. The [`dsh-platform`](../../bundle/platform/README.md) overlay mounts this package and points `storage-domain` at `backend: pg`.

## Configuration (schemastery)

```ts
interface Config {
  connectionString: string
  poolSize?: number
}
```

`poolSize` defaults to `10`. The backend may share a `DATABASE_URL` with `dsh-session-persistence-pg` but uses its own connection pool.

## Model Experience

### Stored domain records

#### What the model sees

Nothing. This backend contributes no prompt, tool, or schema; it persists non-session domain data behind `ctx.storage` for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None �?the backend never touches live request prefixes.

No invariant companion is published because schema-version consistency is an open-time check and durability needs backend round-trip tests; this package exposes no continuously observable in-process relation.

## Known Limitations and Deferred Work

- **No `backupRecord`** �?like the SQLite backend, domain rollback that needs aside-moves falls closed.
- **No schema migration** �?a non-matching layout version rejects at open.
- **Requires reachable PostgreSQL** �?cold open fails loud when the connection string is missing or unreachable.
