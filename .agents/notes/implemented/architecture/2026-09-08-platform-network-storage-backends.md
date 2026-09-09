# Agent Note: Platform network storage backends (Option A)

Status: implemented

English | [中文](2026-09-08-platform-network-storage-backends.zh.md)

## Problem

Same-process multi-tenant DSH stores sessions in a local SQLite file, attachments under `$DSH_HOME/attachments`, and workspace/settings domains under `$DSH_HOME/storages`. That layout blocks shared persistence across hosts, container restarts without a durable volume, and later control-plane / execution-plane splits. Deployments that need Option A (storage externalization without splitting the Host process) need network backends that implement the existing seams rather than rewriting the agent loop.

## Decision

Ship three opt-in providers and one overlay bundle:

1. `@deepseek-ai/dsh-session-persistence-pg` — PostgreSQL `SessionPersistence` (schema 2) with JSONB event rows, `assistant/chunk` pack runs identical to SQLite, in-process write ownership, and best-effort stale `owner_pid` cleanup.
2. `@deepseek-ai/dsh-attachment-s3` — S3-compatible `AttachmentStore` reusing local admission/normalization, content-addressed keys under `v1/objects/…`.
3. `@deepseek-ai/dsh-storage-pg` — PostgreSQL `StorageBackend` registered as `pg` for `dsh-storage-domain`.
4. `@deepseek-ai/dsh-platform` — cordis patch overlay that disables local backends, mounts the three providers, and sets `storage-domain.backend` to `pg`.

Agent-loop, inbox, `session/event` follow, JWT auth, and Typert remotes stay unchanged. Write paths still run in the same process as the API.

## Alternatives considered

- **Reuse SQLite over a network filesystem** — rejected: multi-writer SQLite over NFS/SMB is unsafe and still couples Hosts to a shared mount.
- **Defer pack chunk runs in PostgreSQL** — rejected once schema 2 landed: streaming turns write the same packed physical rows as SQLite; resume expands them to identical logical events without changing the seam.
- **Split API and Worker in the same change** — rejected for Option A: that is L2/L3 work; storage externalization must ship independently.

## Consequences

- Profiles add `@deepseek-ai/dsh-platform` after multi-user and supply `DATABASE_URL` plus `S3_*`.
- Request-image variants are recomputed on read for S3 (not bucket-cached yet).
- Cross-process exclusive writers still rely on later leases; Option A only clears obviously dead `owner_pid` markers.
- Existing schema-1 PostgreSQL databases must be recreated; open rejects a non-matching `schema_version`.

## Required verification

- Unit tests for each provider with in-process substitutes (`pg-mem` for PostgreSQL, mocked S3 client).
- Shared persistence and KV backend contract suites (`runPersistenceContract`, `runKvBackendContract`).
- Pack round-trip coverage: logical event expansion plus fewer physical `events` rows for packed delta runs.
- Package READMEs with Model Experience and Known Limitations; Agent Note format gate.
