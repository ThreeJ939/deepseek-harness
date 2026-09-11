---
description: "Extract plain text from uploaded documents for model prompt injection."
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-document

English | [中文](README.zh.md)

## Summary

Extracts plain text from admitted document attachments (PDF, DOCX, and common text formats) so Host prompt admission can inject truncated document content into the user message. It is a library used by session and subagent prompt paths; it does not register a Cordis service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Call `extractText(data, mediaType, maxChars?)` after document bytes are validated. Pass the function as `extractDocumentText` to `admitPromptContent` when the prompt may contain document parts.

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

Extracted plain text framed by the Host into a text content block inside the user message. Object keys and storage paths never enter the prompt.

#### Token effect

Proportional to truncated extracted length; one document can add up to the configured character budget of text tokens on the first turn that includes it, and again on later turns that replay that user message.

#### KV Cache effect

Document text participates in the normal message prefix; there is no separate document cache key.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Legacy `.doc` and Office binary formats** — mammoth targets DOCX; older binary Office files usually fail extraction.
- **Spreadsheets, PPT, EPUB** — accepted for storage by attachment backends, but this package does not extract them yet.
- **No OCR** — scanned PDFs without a text layer yield empty extraction and are refused.
