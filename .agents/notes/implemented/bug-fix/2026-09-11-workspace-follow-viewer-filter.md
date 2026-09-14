# Agent Note: Workspace follow increments are viewer-scoped

Status: implemented

English | [中文](2026-09-11-workspace-follow-viewer-filter.zh.md)

## Problem

Multi-user baseline for `workspace.follow` already calls `workspaceRegistry.list(ownerUserId)`, but `WorkspaceFeed.publish` pushed every `upsert` / `remove` / `order` increment to every active follower. When user A created a Session (or Workspace) and the registry committed, user B's WebSocket `workspace.follow` received `"type":"upsert"` for A's Workspace, including foreign `sessionIds` and paths. Gateway `$events` `targetUserId` tagging does not cover this dedicated Remote stream.

## Decision

**Bind each follow generation to its viewer and filter increments.** Capture `getPrincipal()?.userId` when opening a follower. Fan out `upsert` / `remove` only when the Workspace owner matches that viewer (same rule as `list(ownerUserId)`). Project `order` frames to the viewer's visible id subset. Project `archived` frames from the committed increment (not a live registry re-read, which can still be stale inside `domain/changed`) to Session ids attributed via live header or Workspace membership; apply the same filter on baseline and unary archive echoes; skip an archived push when the projected set is unchanged. Keep a feed-local owner map so removes can be filtered after the registry row is gone.

## Alternatives considered

**One WorkspaceFeed instance per user** — rejected: domain observation would duplicate; a shared feed with per-follower projection is enough.

**Rely on Client UI to ignore foreign upserts** — rejected: foreign Workspace paths and Session ids still cross the wire.

## Consequences

Authenticated multi-user Clients no longer observe another user's Workspace upsert/remove/order frames or foreign archived Session ids on `workspace.follow`. Single-user followers (no principal) still receive the unfiltered stream. Creating a Session under user A no longer produces a cross-tenant `upsert` on user B's mux stream.
