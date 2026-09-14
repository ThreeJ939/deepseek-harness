# Agent Note: Mux stream pulls re-enter auth ALS

Status: implemented

English | [中文](2026-09-04-mux-stream-als-rebind.zh.md)

## Problem

Multi-user default Workspace provision runs at the start of `workspace.follow` and reads `authMiddleware.getCurrentPrincipal()` ([provision decision](../feature/2026-09-03-multi-user-default-workspace-provision.md)). Mux upgrades bind the JWT principal only for the synchronous `handleUpgrade` call, then store `userId` on `ConnectionMeta`. Later logical-stream pumps opened `workspace.follow` outside ALS, so `provision()` always saw an empty principal and no-oped. Owner-filtered `baseline()` on the same path had the same gap.

## Decision

When `openWireStream` opens a non-`$events` Remote stream and both `authMiddleware` and `ConnectionMeta.userId` are present, wrap the business iterable with `bindAsyncIterableToPrincipal` so each iterator `next` / `return` / `throw` runs inside `runWithPrincipal` for that upgrade-bound user. Keep `$events` on connection `userId` / `targetUserId` filtering. Keep `session.control`'s explicit `viewerUserId` injection.

## Consequences

- Authenticated `workspace.follow` over the live mux can provision and owner-filter using ALS.
- In-process `wireStream.open` without `userId` is unchanged (no principal rebind).
- Host stream handlers that rely on `getCurrentPrincipal()` become valid on the mux path without per-endpoint payload injection.

## Alternatives considered

- **Inject `viewerUserId` into `workspace.follow` like `session.control`** — works, but widens the Remote signature and duplicates the ALS pattern every ALS-reading stream needs.
- **Wrap only `provision()` with an explicit userId argument** — fixes one caller; leaves other follow-time ALS reads broken.
- **`AsyncLocalStorage.enterWith` for the connection lifetime** — discouraged Node API and harder to bound than per-pull `run`.

## Required verification

- Unit: `bindAsyncIterableToPrincipal` restores the principal on `next` and `return`.
- Host mux: authenticated upgrade + `feed/whoami` stream item equals the upgrade `userId`.
