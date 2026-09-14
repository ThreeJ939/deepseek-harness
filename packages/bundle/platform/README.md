# @deepseek-ai/dsh-platform

English | [中文](README.zh.md)

Network-storage overlay bundle for Option A platformization. [`cordis.patch.yml`](cordis.patch.yml) disables local SQLite session persistence, local attachments, and JSON storage; mounts [`dsh-session-persistence-pg`](../../session/session-persistence-pg/README.md), [`dsh-attachment-s3`](../../attachment/attachment-s3/README.md), and [`dsh-storage-pg`](../../storage/storage-pg/README.md); and points `storage-domain` at backend `pg`.

Apply over a multi-user composition, for example:

```text
dsh.profile.bundles:
  - @deepseek-ai/dsh-base
  - @deepseek-ai/dsh-web-app
  - @deepseek-ai/dsh-multi-user
  - @deepseek-ai/dsh-platform
```

Required environment variables: `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Optional: `PG_POOL_SIZE`, `S3_REGION` (default `us-east-1`), `S3_FORCE_PATH_STYLE` (default enabled; set `0` to disable). `DATABASE_URL` is a standard Postgres URL (credentials in the URL). Local startup: [multi-user LOCAL-DEV](../multi-user/LOCAL-DEV.zh.md). Install this bundle with `dsh plugin �?add` (or keep it in `dsh.profile.bundles`); a bare `--patch` of this overlay alone cannot resolve its provider packages from a stock web profile. Do not both `plugin add` and `--patch` the same bundle.

Design record: [platform network storage backends Agent Note](../../../.agents/notes/implemented/architecture/2026-09-08-platform-network-storage-backends.md).

## Model Experience

None as a bundle; mounted plugins keep their own model-facing surfaces.

No invariant companion is published because this package is a static patch-list carrier; each inserted provider owns that row's invariants, and the bundle owns no mutable relation to check.

## Known Limitations and Deferred Work

- **Still a single Host process** �?API and Worker remain co-located; queue/lease horizontal scaling is out of scope for this overlay.
- **Environment-driven wiring** �?missing `DATABASE_URL` or S3 credentials fail at plugin load rather than falling back to local disk.
