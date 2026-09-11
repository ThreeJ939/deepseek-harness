# Agent Note: Same-process multi-tenant ownership

Status: implemented

English | [中文](2026-08-27-same-process-multi-tenant.zh.md)

## Problem

DeepSeek Harness was a single-user local service. A department deployment that
shares one process across authenticated users needs isolation for sessions,
workspaces, credentials, settings, event streams, and tool filesystem paths —
without standing up one process or container per user.

## Decision

Ship same-process multi-tenancy behind an opt-in `dsh-multi-user` bundle on
top of the official Host API controllers (not the retired monolithic apiproxy).

1. **Auth.** `dsh-host-auth-middleware` registers webserver middleware that
   verifies `Authorization: Bearer` HS256 JWTs (or `?access_token=` on upgrades),
   stores `AuthenticatedPrincipal` in AsyncLocalStorage, and returns 401 for
   unauthenticated `/api` requests except `/api/auth.exchange`.
   `dsh-host-auth-login` mints JWTs from a SaaS userinfo exchange.
   When the middleware is composed, Connection serves the SPA without the
   process-token cookie so `dsh-client-ui-auth` can present login; `/api` still
   requires a JWT (or the existing browser cookie in single-user mode).
2. **Session ownership.** Optional `SessionHeader.ownerUserId` (and create
   meta) preserves single-user logs. `session-controller` stamps the principal
   on create, filters list, and denies cross-user resolve/resume.
3. **Workspace ownership.** Optional `Workspace.ownerUserId` with list/create
   filtering and mutate checks in `workspace-controller`.
4. **Credentials / settings.** Credentials support `readOnly`. Settings-file
   supports `userOverlay`: authenticated writes go to
   `$DSH_HOME/user-settings/<userId>.yaml` and reads merge deployment defaults.
   The settings Remote also refuses credential writes when a principal is present.
5. **Sandbox.** `dsh-user-path-policy` denies tool absolute paths outside
   `$DSH_HOME/workspaces/<ownerUserId>/` when the session has an owner.
6. **Default Workspace.** `dsh-multi-user` provides `defaultWorkspaceProvisioner`:
   on authenticated `workspace.follow`, when the caller has no Workspace, mkdir
   `$DSH_HOME/workspaces/<userId>/default/` and register it
   ([provision decision](../feature/2026-09-03-multi-user-default-workspace-provision.md)).
7. **Bundle.** `dsh-multi-user` mounts auth + path policy + default Workspace provision, switches session persistence to handle-based SQLite schema 18 (nullable `owner_id`; [sqlite handle](2026-09-03-sqlite-handle-session-persistence.md)), disables JSONL, enables read-only credentials and settings overlays, and configures `ui-auth`. API controllers also filter by `ownerUserId`.

## Consequences

- Profiles that omit the multi-user bundle keep single-user BrowserAuth behavior.
- Mux/WebSocket upgrades authenticate JWT when auth-middleware is present and
  store `userId` on the connection. Gateway re-enters ALS on each logical-stream
  pull (`bindAsyncIterableToPrincipal`) so handlers such as `workspace.follow`
  can read `getCurrentPrincipal()`; `$events` filtering still uses connection
  `userId` / `targetUserId` rather than ALS.
- Multi-user deployments recreate schema-17 SQLite session databases; no
  migration ships.

## Alternatives considered

- **One process or container per user** — stronger isolation, higher idle cost;
  chosen against for department shared-key deployments.
- **Required `owner_id NOT NULL` without optional header** — breaks single-user
  and legacy logs; optional header keeps both modes.
- **API-side owner filtering only (JSONL)** — kept as the single-user default;
  multi-user bundle additionally mounts SQLite schema 18 for durable `owner_id`.
- **Replace BrowserAuth entirely** — rejected; multi-user layers JWT beside it.
