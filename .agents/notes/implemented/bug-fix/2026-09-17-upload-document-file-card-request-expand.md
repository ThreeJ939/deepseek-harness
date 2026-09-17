# Agent Note: Keep uploaded documents as file cards until request projection

Status: implemented

English | [中文](2026-09-17-upload-document-file-card-request-expand.zh.md)

## Problem

Prompt admission replaced document-typed uploads with durable `text` blocks (`[Document: …]\n…`). The chat UI joins every user `text` block into the bubble, so uploaded documents appeared as full extracted content instead of file cards.

## Decision

Leave every upload as a durable `{ type: 'file', attachment }` in the session log. Expand document media types to framed extracted text only during LLM request assembly (`projectFilesForRequest`); non-document files keep handle text. Do not add `extractedText` onto durable file blocks or bump `SESSION_FORMAT_VERSION`. The extractor package and document MIME set remain owned by [document attachments](../feature/2026-09-09-document-attachments-and-bmp.md).

## Alternatives considered

**Restore upstream `document` ContentBlock with stored `extractedText`.** Rejected for this fix: released format validation only allows `file` keys `type` and `attachment`, and harness already uses verbatim `file` plus request-time handle projection.

**Keep admission-time expansion and hide document text in the UI.** Rejected: model-visible text would still live in the durable user message under a text tag, fighting MessageItem's text join.

## Consequences

Chat shows file cards for new document uploads. The model still receives extracted document text when `mediaType` is a known document type and attachment bytes are readable; otherwise it receives the path handle. Historical messages that already inlined document text are unchanged. Token metering still prices the sync handle via `fileRequestText`.
