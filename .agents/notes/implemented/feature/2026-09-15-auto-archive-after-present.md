# Agent Note: Auto-archive after successful present

Status: implemented

English | [中文](2026-09-15-auto-archive-after-present.zh.md)

## Problem

Web and multi-user users need a Download action after the model presents a file. Relying on a second explicit `archive_deliverable` call left present-only turns without archived cards. The earlier archive-download note rejected Host auto-archive to keep model-visible steps; product experience then required reversing that for the common present path.

## Decision

Keep `present` and `archive_deliverable` as separate tools. In [`dsh-tool-deliverable-archive`](../../../../packages/fs/tool-deliverable-archive/README.md), when `autoArchiveAfterPresent` is true (default), a `tools/post-execute` listener archives a successful `present` through the same `archiveWorkspaceFiles` helper as the explicit tool. Archive failure returns `{ kind: 'block' }`, so present becomes `isError` and neither `deliverables/presented` nor `deliverables/archived` is appended. Success stores pending archives under the present execution and the existing `tools/result` listener appends `deliverables/archived` with the present `callId`.

## Alternatives considered

**Changing `present` itself to write attachments** would couple editable-source declaration to durable copies inside `tool-present`. Rejected; listening stays in the archive package (scheme B).

**Only documenting must-call archive** still depends on model compliance. Rejected for Web download reliability.

**Best-effort archive after `tools/result`** cannot fail present and would leave presented-without-download turns. Rejected in favor of `post-execute` block.

## Consequences

Deployments that mount this plugin with the default switch require an attachment store for successful present. Operators may set `autoArchiveAfterPresent: false`. Explicit `archive_deliverable` remains for archive-without-present. This reverses the “no Host auto-archive” alternative in [deliverable archive download](2026-09-14-deliverable-archive-download.md) for the present success path only.
