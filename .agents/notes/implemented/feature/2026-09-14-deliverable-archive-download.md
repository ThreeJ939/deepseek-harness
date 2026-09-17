# Agent Note: Deliverable archive and authenticated Web download

Status: implemented

English | [中文](2026-09-14-deliverable-archive-download.zh.md)

## Problem

Cloud multi-user deployments store durable bytes in S3-compatible attachment storage, but `present` only declares workspace source paths without copying contents. Remote browsers cannot open Host desktop applications, and workspace files disappear when containers or user workspaces are cleaned. Users need a downloadable immutable copy without changing the editable-source delivery contract.

## Decision

Ship an independent `archive_deliverable` tool in [`dsh-tool-deliverable-archive`](../../../../packages/fs/tool-deliverable-archive/README.md). It streams workspace file bytes into `ctx.attachments` via `saveFileStream` and appends `deliverables/archived` with `FileAttachmentRef` values after a successful final tool result. `present` remains unchanged as the editable-source declaration. By default the archive plugin also auto-archives a successful `present` through `tools/post-execute` ([auto-archive after present](2026-09-15-auto-archive-after-present.md)).

[`dsh-client-ui-deliverables`](../../../../packages/client/ui-deliverables/README.md) registers `GET|HEAD /api/deliverable.download?sessionId=&seq=&index=`. The route reads the archived event by coordinates, verifies the file entry, and streams `attachments.readFileStream` with `Content-Disposition: attachment`. Authorization requires the attachment reference to appear in the Session log; bare `attachmentId` query parameters are rejected so content-addressed digests cannot be guessed across tenants. The browser half renders archived cards with a Download action that `GET`s with the multi-user Bearer JWT when present, materializes a blob, and saves through a temporary object URL.

The `standard`, `ptc`, and `cordis` presets mount the archive tool beside present. Platform deployments continue to provide S3 through `dsh-attachment-s3`; local attachment storage remains valid for development.

## Alternatives considered

**Extending `present` to archive by default** would rewrite the shipped editable-source delivery decision and force a single open-vs-snapshot product meaning. Rejected so present cards keep Sidebar preview and Host native open against live workspace files.

**Host auto-archive after every successful present** was initially rejected in favor of an explicit model-visible tool. That alternative was later reversed for the present success path only; see [auto-archive after present](2026-09-15-auto-archive-after-present.md).

**Presigned S3 URLs** reduce Host bandwidth but are absent from the current attachment seam and complicate multi-tenant expiry. Deferred; the first release proxies through the authenticated Fetch route like session ZIP export.

**A second artifact service** would duplicate the attachment store. Rejected; verbatim file attachments already provide content-addressed durability.

## Consequences

Sessions that contain `deliverables/archived` require readers that know the event type. Downloads depend on a mounted attachment store; without one the tool fails closed and the download route is not registered. Attachments are never deleted automatically. Session ZIP export already streams referenced file attachments; archived deliverables participate through the same store.

## Required verification

- Host unit tests for archive success, validation failures, missing attachments, and cancellation.
- Host Fetch-route tests for coordinate validation, Content-Disposition, and 404 cases.
- Client tests for `deliverables/archived` turn folding, archived cards, and download preflight.
- Preset wiring for `standard` / `ptc` / `cordis`.
- Tool catalog regeneration includes `archive_deliverable`.
