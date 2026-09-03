# @deepseek-ai/dsh-multi-user

English | [中文](README.zh.md)

Same-process multi-tenant profile bundle. [`cordis.patch.yml`](cordis.patch.yml) mounts JWT auth ([`dsh-host-auth-middleware`](../../host/auth-middleware/README.md)), switches session persistence to SQLite ([`dsh-session-persistence-sqlite`](../../session/session-persistence-sqlite/README.md)), disables JSONL, enables credentials `readOnly`, settings `userOverlay`, the per-user workspace path bound ([`dsh-user-path-policy`](../../sandbox/user-path-policy/README.md)), and a default-Workspace provisioner that registers `$DSH_HOME/workspaces/<userId>/default` on the first authenticated `workspace.follow` when the user has no Workspace yet.

Apply over a base/web composition with `dsh --profile multi-user` (or an equivalent patch layer). Set `DSH_JWT_SECRET` (at least 32 characters) before boot. Local PowerShell startup and JWT minting: [LOCAL-DEV.zh.md](LOCAL-DEV.zh.md).

Design record: [same-process multi-tenant Agent Note](../../../.agents/notes/implemented/architecture/2026-08-27-same-process-multi-tenant.md). Default Workspace provision: [default Workspace provision Agent Note](../../../.agents/notes/implemented/feature/2026-09-03-multi-user-default-workspace-provision.md). End-to-end message flow: [MESSAGE-FLOW.md](MESSAGE-FLOW.md).

## Model Experience

None as a bundle; mounted plugins keep their own model-facing surfaces.

## Known Limitations and Deferred Work

- **Hard cut on SQLite schema 18** — schema 17 session databases are incompatible; recreate rather than migrate.
- **Deployment-level credentials** — users cannot write API keys through the gateway when this bundle is active.
