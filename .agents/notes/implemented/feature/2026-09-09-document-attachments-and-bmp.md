# Agent Note: Document attachments with sync text injection and BMP images

Status: implemented

English | [中文](2026-09-09-document-attachments-and-bmp.zh.md)

## Problem

Composer intake accepted only raster images. Product chat needs document uploads that store the original file and still give models without a document modality readable plain text. RAG, async parse status, and a cross-session “my files” library are out of scope.

## Decision

**Unified file path, optional media type.** Harness keeps one verbatim `FileAttachmentRef` / `saveFileStream` path for non-image uploads. Optional `mediaType` on `FileAttachmentRef` and `SaveFileStreamAttachment` carries the browser-declared MIME type through the Worker upload query string into storage and the durable reference.

**No separate document attachment type.** Unlike an earlier DocumentAttachmentRef design, documents are files whose `mediaType` matches a known document set. Clients keep `addFiles()` and `kind: image | file` drafts.

**Extractor library, not a Cordis plugin.** `@deepseek-ai/dsh-attachment-document` defines local `DocumentMediaType` / `DOCUMENT_MEDIA_TYPES` / `isDocumentMediaType` and exports `extractText` (PDF via `pdf-parse`, DOCX via `mammoth`, UTF-8 for text-like types). LLM request assembly expands document-typed durable file blocks to framed extracted text via `projectFilesForRequest`; admission keeps the structured `file` block for UI cards ([file-card / request expand](../bug-fix/2026-09-17-upload-document-file-card-request-expand.md)). Non-document files stay durable file references and project as handle text.

**S3 and local stores.** Local and S3 backends persist `mediaType` on the file reference. S3 stores verbatim files under `v1/files/<sha>/<sha>` beside image objects under `v1/objects/…`.

**BMP.** `ImageMediaType` includes `image/bmp`. Local and S3 stores admit BMP; normalization excludes BMP from pass-through (same as GIF). Client MIME routing and DeepSeek file-store exhaustiveness follow the same union ([BMP admission](2026-09-10-image-bmp-admission.md)).

## Alternatives considered

**DocumentAttachmentRef + saveDocument API** — rejected for harness: would fork the client upload path away from Worker streaming and duplicate UI attachment kinds.

**RAG / embedding index at admit time** — rejected for this cut: product requirement is immediate model-visible text on the turn that uses the upload.

**Async extraction with parse-status UI** — rejected: adds session events, polling, and failure surfaces beyond the sync inject contract.

**Inline framed text into the durable user message at admit time** — shipped in the first cut, then reversed so chat file cards are not replaced by full extracted text ([file-card / request expand](../bug-fix/2026-09-17-upload-document-file-card-request-expand.md)).

## Consequences

Spreadsheets, PPT, and EPUB may be stored when declared but currently fail extraction. Scanned PDFs without a text layer fail. Model prompts grow by the extractor character budget when request projection succeeds. Generic non-document files continue to project as handle text at request assembly.
