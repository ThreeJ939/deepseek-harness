# @deepseek-ai/dsh-session-persistence-pg

English | [中文](README.zh.md)

An opt-in PostgreSQL `SessionPersistence` provider. It stores session events as JSONB rows and serves the handle-based `SessionPersistence` API used by resume, list, and follow. Official single-user profiles keep JSONL; the multi-user bundle keeps SQLite; the [`dsh-platform`](../../bundle/platform/README.md) overlay mounts this package with `DATABASE_URL`.

Every session shares one PostgreSQL database. Callers address a stored session through a `SessionHandle` from `create`/`open`. Write ownership is exclusive in-process (same as SQLite); at open, the provider best-effort clears stale `is_owned` markers whose `owner_pid` is absent from `pg_stat_activity`.

## Storage model

Schema 2 uses three tables: `persistence_state` (store identity + schema version), `sessions` (immutable header fields + revision + ownership markers), and `events` (contiguous physical rows keyed by `session_id, seq` with JSONB `data`). Appends run in an explicit transaction, reject a non-contiguous first logical seq, insert the batch, and increment revision once. Normal appends never delete or replace earlier rows.

Like the SQLite provider, consecutive same-block `assistant/chunk` delta runs of length ≥ 3 pack into one physical row (`text-chunks` / `reasoning-chunks` / `tool-call-chunks`, marked `ignorable = FALSE`). Resume expands pack rows back to the original logical events; physical encoding never reaches prompts, tools, replay, or live `session/event` delivery.

## Configuration (schemastery)

```ts
interface Config {
  connectionString: string
  poolSize?: number
}
```

`poolSize` defaults to `10`. Path and file-permission checks from the SQLite provider do not apply; the database must already be reachable with credentials that can create the schema tables on first open.

## Model Experience

### Resumed conversation history

#### What the model sees

Nothing specific to PostgreSQL. Resume restores the same logical events and derived messages as JSONL or SQLite; physical storage columns never reach prompts, tools, replay, or live `session/event` delivery.

#### Token effect

Zero live-request tokens. Resume pays only for the retained logical history and current request envelope.

#### KV Cache effect

Physical storage does not mutate request prefixes. Provider cache reuse depends on the reconstructed history, current envelope, and model route exactly as with other persistence backends.

## Known Limitations and Deferred Work

- **In-process write ownership** — cross-process single-writer fencing beyond stale `owner_pid` cleanup is deferred to a later lease layer (see platform architecture Option A → L3).
- **No schema migration** — a non-matching `schema_version` rejects at open; recreate rather than migrate during pre-release.
- **Requires reachable PostgreSQL** — cold open fails loud when `DATABASE_URL` is missing or unreachable.
