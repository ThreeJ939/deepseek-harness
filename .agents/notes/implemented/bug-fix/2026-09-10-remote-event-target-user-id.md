# Agent Note: Remote event fanout carries session owner targetUserId

Status: implemented

English | [中文](2026-09-10-remote-event-target-user-id.zh.md)

## Problem

Multi-user Session isolation stamps `ownerUserId`, filters list/resolve APIs, and filters `session.control` by `viewerUserId` ([same-process multi-tenant](../architecture/2026-08-27-same-process-multi-tenant.md)). API Gateway already skips `$events` frames whose `targetUserId` does not match the connection. Harness `dsh-api-remotes` still forwarded Session emits and scoped waterfalls without `targetUserId`, so live sidebar and activity updates for one user's Sessions were broadcast to every authenticated browser.

## Decision

**Tag owner-scoped forwarded events at the remotes source.** Keep a `sessionId → ownerUserId` map updated from `api-session/added` / `removed`. Attach `targetUserId` on Session-related emits (`api-session/*`, `agent-preset/selected`, `goal/activation-changed`) and on Agent-scoped waterfalls (resolved from the map or optional live `sessions` registry). Leave global emits (settings, commands, …) untagged so every connection still receives them.

## Alternatives considered

**Filter only in Client UI** — rejected: other users would still receive foreign Session metadata on the wire.

**Require every emit to go through session-controller Remote streams** — rejected: `$events` already fans Cordis notifications; tagging at the allowlist source matches Gateway's existing contract.

## Consequences

Multi-user Clients no longer observe another user's Session added/removed/activity or goal-activation frames on `$events`. Single-user and unauthenticated connections (no connection `userId`) still receive every frame. Aligns harness remotes with the deepseek fork behavior documented in multi-user MESSAGE-FLOW.
