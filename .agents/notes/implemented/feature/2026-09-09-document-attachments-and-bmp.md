# Agent Note: Document attachments with sync text injection and BMP images

Status: implemented

English | [中文](2026-09-09-document-attachments-and-bmp.zh.md)

## Problem

Composer intake accepted only raster images (without BMP). Product chat needs a parallel document upload path that stores the original file, extracts plain text synchronously at admit time, and injects that text into the user message so models without a document modality can still read the content. RAG, async parse status, and a cross-session “my files” library are out of scope.

## Decision

**BMP on the image path.** `ImageMediaType` includes `image/bmp`. Local and S3 stores admit BMP; normalization treats BMP like GIF (pass-through, no recompress). Client MIME validation and DeepSeek file-store exhaustiveness follow the same union.

**Document vocabulary on the attachment seam.** `DocumentMediaType`, `DocumentAttachmentRef`, `DocumentAttachmentLimits`, encoded/save document types, and a `document` branch on `PromptContentPart` / `AdmittedPromptContentPart` live in `@deepseek-ai/dsh-attachment`. `AttachmentStore` adds batch `saveDocuments` / `readDocument` with optional `documentLimits`; providers that omit limits refuse document batches.

**Storage keys.** Local files land under `documents/`; S3 uses content-addressed `v1/documents/<sha>/<sha>`.

**Extractor library, not a Cordis plugin.** `@deepseek-ai/dsh-attachment-document` exports `extractText` (PDF via `pdf-parse`, DOCX via `mammoth`, UTF-8 for text-like types). Session-controller and subagent prompt paths pass it as `extractDocumentText` into `admitPromptContent`. `admittedPartsToContentBlocks` turns document parts into framed text blocks; there is no new LLM `ContentBlock` type.

**Client UX.** Composer drafts are a `image | document` union sharing the existing `imageIds` flight list. InputBar adds a document picker; `ComposerAttachments` renders document chips and splits drops into image vs non-image batches. `documentLimits` projects beside `imageLimits` for intake pre-checks and error copy. Document-only sends release drafts on successful prompt; mixed sends release documents immediately and keep image echo retirement for images.

## Alternatives considered

**RAG / embedding index at admit time** — rejected for this cut: product requirement is immediate model-visible text in the same user message, not retrieval across a corpus.

**Async extraction with parse-status UI** — rejected: adds session events, polling, and failure surfaces beyond the sync inject contract.

**Separate Cordis document service** — rejected while only one extractor is required; callers inject `extractText` at the admit call site.

**New model content-block type for documents** — rejected so every model path can consume framed text without provider changes.

## Consequences

Spreadsheets, PPT, and EPUB may be stored when whitelisted but currently fail extraction. Scanned PDFs without a text layer fail. Model prompts grow by up to `maxExtractedCharsPerDocument` per document on the turns that replay that user message. Fixture transports should mirror `documentLimits` when exercising intake pre-check copy in keyless demos.
