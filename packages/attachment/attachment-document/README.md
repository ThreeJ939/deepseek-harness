---
description: "Extract plain text from uploaded documents for LLM request projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-document

English | [中文](README.zh.md)

## Summary

Extracts plain text from document attachments (PDF, DOCX, and common text formats) so LLM request projection can frame truncated document content for the model. It is a library used by `dsh-llm` request assembly; it does not register a Cordis service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Call `extractText(data, mediaType, maxChars?)` after document bytes are available. `dsh-llm` invokes it while projecting durable file blocks for one provider request.

<a id="understand-the-implementation"></a>
## Understand the implementation

| Format | Extractor |
|---|---|
| PDF | `pdf-parse` |
| DOCX / DOC | `mammoth` |
| plain text, JSON, Markdown, CSV, SQL, Java source | UTF-8 decode |

Extraction truncates to a character budget (default 50_000) before returning.

<a id="model-experience"></a>
## Model Experience

### Document text injection

#### What the model sees

Extracted plain text framed by request projection into a text content block sent to the model. The durable session log keeps the structured file reference; object keys and storage paths never enter the framed document body.

#### Token effect

Proportional to truncated extracted length; one document can add up to the configured character budget of text tokens on each provider request that expands it.

#### KV Cache effect

Document text participates in the normal message prefix; there is no separate document cache key.

No invariant companion is published because this library owns no Cordis registrations or mutable shared state; extraction is a pure function over caller-owned bytes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Legacy `.doc` and Office binary formats** �?mammoth targets DOCX; older binary Office files usually fail extraction.
- **Spreadsheets, PPT, EPUB** �?accepted for storage by attachment backends, but this package does not extract them yet.
- **No OCR** �?scanned PDFs without a text layer yield empty extraction and are refused.
