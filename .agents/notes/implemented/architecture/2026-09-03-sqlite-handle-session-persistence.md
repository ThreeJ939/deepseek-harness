# Agent Note: SQLite handle-based session persistence

Status: implemented

English | [中文](2026-09-03-sqlite-handle-session-persistence.zh.md)

## Problem

The handle-based persistence seam ([decision](2026-08-27-handle-based-session-persistence.md)) replaced coordinator `create`/`append`/`load`. The same-process multi-tenant bundle ([decision](2026-08-27-same-process-multi-tenant.md)) still needs one SQLite database with `owner_id` so authenticated users share a process without scanning per-session JSONL files. Keeping the coordinator adapter next to the handle abstract class made the tree unbuildable.

## Decision

`@deepseek-ai/dsh-session-persistence-sqlite` implements the five-method handle seam: `create`/`open` return `SessionHandle`; `flush`/`stat`/`list` match JSONL. Schema 18 and the physical store (`appendBatch`, packed rows, `owner_id`) stay. `list` accepts `ownerUserId`. `seed_length` stores `inheritedEventCount` when `header.isSeeded` is true.

Official single-user profiles remain JSONL. The multi-user bundle still mounts SQLite and disables JSONL. The coordinator module is absent; live writes route through the handle like JSONL.

This tree therefore keeps an opt-in second authoritative Session format for multi-user deployments, which [JSONL-only first-party persistence](../simplification/2026-08-30-jsonl-only-session-persistence.md) rejected for the default product.

## Consequences

- Multi-user listing filters at SQL (`select-sessions-by-owner`) and includes in-process pending sessions.
- Schema-17 databases still reject; no migration ships.
- Persistence tests use `runPersistenceContract`, not a coordinator contract.

## Alternatives considered

- **JSONL-only plus in-memory `ownerUserId` filter.** Rejected: the multi-user deployment wants one WAL database and indexed owner queries.
- **Keep the coordinator behind SQLite only.** Rejected: a second seam next to handles reintroduces ownerless adoption and breaks the abstract class.
