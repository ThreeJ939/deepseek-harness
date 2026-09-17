# Agent Note: JSON-encode PostgreSQL `surface_op`

Status: implemented

English | [中文](2026-09-15-pg-surface-op-json-encoding.zh.md)

## Problem

`dsh-session-persistence-pg` wrote `surfaceOp` into TEXT without `JSON.stringify` and read it back without `JSON.parse`. The append string survived; replace objects became JSON text in the column and reloaded as strings. Cold open then failed validation with `session event "system/message" carries an invalid surfaceOp`, so multi-turn sessions that replaced the system prompt (including ones that archived downloadable deliverables) could not resume.

## Decision

Encode and decode `surface_op` as JSON text, matching SQLite. Keep accepting the legacy bare `append` literal so already-written append-only rows remain readable. Do not bump `SCHEMA_VERSION`: existing replace rows that node-pg already stored as JSON text become valid after `JSON.parse`.

## Alternatives considered

**Bump schema version and recreate.** Rejected: it discards local platform databases when a decode-compatible fix recovers both legacy append literals and JSON-text replace rows.

**Store `surface_op` as JSONB.** Deferred; TEXT-plus-JSON matches the SQLite column and needs no schema bump.

## Consequences

New writes store `"append"` (quoted JSON) rather than the bare token. Resume after a system-prompt replace works for new and previously unloadable replace rows. Official upstream remains JSONL-only and does not ship this provider.
