# Agent Note: Document attachments with sync text injection and BMP images

Status: implemented

English | [中文](2026-09-09-document-attachments-and-bmp.zh.md)

## Problem

Composer intake accepted only raster images. Product chat needs document uploads that store the original file, extract plain text at prompt admit time, and inject that text into the user message so models without a document modality can still read the content. RAG, async parse status, and a cross-session “my files” library are out of scope.

## Decision

**Unified file path, optional media type.** Harness keeps one verbatim `FileAttachmentRef` / `saveFileStream` path for non-image uploads. Optional `mediaType` on `FileAttachmentRef` and `SaveFileStreamAttachment` carries the browser-declared MIME type through the Worker upload query string into storage and the durable reference.

**No separate document attachment type.** Unlike an earlier DocumentAttachmentRef design, documents are files whose `mediaType` matches a known document set. Clients keep `addFiles()` and `kind: image | file` drafts.

**Extractor library, not a Cordis plugin.** `@deepseek-ai/dsh-attachment-document` defines local `DocumentMediaType` / `DOCUMENT_MEDIA_TYPES` / `isDocumentMediaType` and exports `extractText` (PDF via `pdf-parse`, DOCX via `mammoth`, UTF-8 for text-like types). Session-controller `expandDocumentFiles` reads admitted document-typed files and replaces them with framed text blocks before `createUserMessage`. Non-document files stay durable file references.

**S3 and local stores.** Local and S3 backends persist `mediaType` on the file reference. S3 stores verbatim files under `v1/files/<sha>/<sha>` beside image objects under `v1/objects/…`.

**BMP.** `ImageMediaType` includes `image/bmp`. Local and S3 stores admit BMP; normalization excludes BMP from pass-through (same as GIF). Client MIME routing and DeepSeek file-store exhaustiveness follow the same union ([BMP admission](2026-09-10-image-bmp-admission.md)).

## Alternatives considered

**DocumentAttachmentRef + saveDocument API** — rejected for harness: would fork the client upload path away from Worker streaming and duplicate UI attachment kinds.

**RAG / embedding index at admit time** — rejected for this cut: product requirement is immediate model-visible text in the same user message.

**Async extraction with parse-status UI** — rejected: adds session events, polling, and failure surfaces beyond the sync inject contract.

**Extract only at LLM projection time** — rejected for this cut so the session log and the model see the same framed text for documents.

## Consequences

Spreadsheets, PPT, and EPUB may be stored when declared but currently fail extraction. Scanned PDFs without a text layer fail. Model prompts grow by the extractor character budget on turns that replay that user message. Generic non-document files continue to project as handle text at request assembly.
