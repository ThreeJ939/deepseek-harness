---
description: "Archive workspace files into durable attachment storage with archive_deliverable; configuration, Session ownership, and download references."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-deliverable-archive

English | [中文](README.zh.md)

## Summary

Use `archive_deliverable` to copy existing Session-filesystem files into the mounted attachment store so the Web UI can download an immutable snapshot. The tool records paths, optional descriptions, and `FileAttachmentRef` values. It does not replace `present`, which continues to declare editable workspace sources without copying bytes. By default, a successful `present` is also archived automatically so Web downloads appear without a second model call.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `standard`, `ptc`, and `cordis` agent presets mount this plugin. With `autoArchiveAfterPresent` (default `true`), a successful `present` archives the same files before the call settles; archive failure blocks the present result. Call `archive_deliverable` with `files: [{ path, description? }]` only when you need an immutable copy without presenting, or for files you did not present. Files must be regular files accessible through the Session filesystem. Relative paths resolve against the Session working directory. Missing files, directories, final symbolic links, and provider-denied paths fail the call. A missing attachment store fails the call (and blocks present when auto-archive is on) with a clear error.

Mount it in an agent's Cordis composition with `tools`, `fs`, and the `turnBoundary` Session projection available; attach an attachment provider such as `dsh-attachment-local` or `dsh-attachment-s3` before execution:

```yaml
- name: '@deepseek-ai/dsh-tool-deliverable-archive'
  config:
    maxFiles: 8
    autoArchiveAfterPresent: true
```

| Field | Default | Meaning |
|---|---|---|
| `maxFiles` | `8` | Positive maximum file count per explicit call or auto-archive batch |
| `autoArchiveAfterPresent` | `true` | Archive on successful `present` via `tools/post-execute`; failure blocks present |

The file-count limit is validated at mount. The tool requires an agent Session with a workspace and an open turn. Archive ownership belongs to the calling Session.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Shared `archiveWorkspaceFiles` resolves paths through the configured filesystem provider, streams bytes through `readByteRange`, and commits them with `attachments.saveFileStream`. Explicit `archive_deliverable` execute and the present `tools/post-execute` listener both use that helper. Successful final `tools/result` notifications append `deliverables/archived`, including nested calls and auto-archived present executions. Blocked results publish none. Each plugin instance records only calls it pending-mapped.

When `autoArchiveAfterPresent` is true and `systemPrompt` is available, a fixed prompt section tells the model not to re-archive the same presented files.

The pure `./types` entry declares `ArchivedFile` and the Session event without importing Host runtime code. Web download routes authorize by Session event coordinates rather than bare attachment ids.

**Runtime invariant:** No companion is published. Tool, post-execute, optional prompt, and event registrations are effect-owned; the attachment store owns file bytes and the Session log owns download authorization.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Filesystem subsystem](../../../docs/subsystems/filesystem.md) — provider paths and errors.
- [Attachment subsystem](../../../docs/subsystems/attachment.md) — verbatim file storage.
- [Web deliverables](../../client/ui-deliverables/README.md) — archived download cards and Fetch route.
- [Archive download decision](../../../.agents/notes/implemented/feature/2026-09-14-deliverable-archive-download.md) — separation from present and authorization rules.
- [Auto-archive after present](../../../.agents/notes/implemented/feature/2026-09-15-auto-archive-after-present.md) — post-execute block semantics.

<a id="model-experience"></a>
## Model Experience

### archive_deliverable

#### What the model sees

The [archive_deliverable schema](../../../docs/tool-catalog.md#archive_deliverable) asks for existing accessible files and explains that successful present already archives for Web download when auto-archive is on. Results report `Archived <path> (<bytes> bytes)` for each file; the program result and durable event contain paths, optional descriptions, and attachment references. Auto-archive after present writes the same durable event under the present call id without a separate tool row.

#### Token effect

One tool schema per mounted agent, one optional fixed prompt paragraph when auto-archive is on, and one result line per explicitly archived file. File bytes do not enter model messages.

#### KV Cache effect

The tool schema and optional prompt section are static while the plugin is mounted. Archive result text extends the conversation and does not rewrite the prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Attachments are never deleted automatically after archive.
- Large files stream through the attachment provider; S3 providers may still buffer a complete object during commit.
- Presigned object URLs are not issued; Web downloads proxy through the Host Fetch route.
- Auto-archive after present requires a mounted attachment store; without one, present fails closed when the switch is on.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer working context — click to expand</summary>

None.

</details>
