# @deepseek-ai/dsh-user-path-policy

English | [中文](README.zh.md)

Multi-tenant `tools/pre-execute` policy. When the executing session's header carries `ownerUserId`, any absolute path in tool arguments must stay under `$DSH_HOME/workspaces/<ownerUserId>/`. Sessions without an owner are unrestricted by this plugin (single-user deployments).

Compose via [`dsh-multi-user`](../../bundle/multi-user/README.md). Helper exports `isPathInside` and `collectAbsolutePaths` are used by tests and can be reused by other path gates.

## Config

- `dshHome` �?optional override of the harness home used to resolve the per-user workspace root.

## Model Experience

None as a standalone prompt contribution; denials surface through the normal tool-result path when a path is refused.

No invariant companion is published because this plugin only contributes a `tools/pre-execute` waterfall listener whose effect is observed through denial outcomes, not a durable owned relationship between registries.

## Known Limitations and Deferred Work

- **Absolute paths only** �?relative arguments are not rewritten or re-rooted here.
- **String-shaped paths** �?paths embedded in non-string encodings are not scanned.
