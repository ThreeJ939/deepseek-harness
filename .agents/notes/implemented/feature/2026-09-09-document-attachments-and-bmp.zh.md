# Agent Note: Document attachments with sync text injection and BMP images

Status: implemented

English | [中文](2026-09-09-document-attachments-and-bmp.md)

## Problem

Composer 入口原先只接受光栅图。产品聊天需要文档上传：原样存储文件，并让不支持文档模态的模型仍能读到纯文本。RAG、异步解析状态、跨会话「我的文件」库不在本切口范围。

## Decision

**统一文件路径，可选 mediaType。** harness 对非图片上传保持单一的 verbatim `FileAttachmentRef` / `saveFileStream` 路径。`FileAttachmentRef` 与 `SaveFileStreamAttachment` 的可选 `mediaType` 把浏览器声明的 MIME 经 Worker 上传查询参数写入存储与持久引用。

**不单独引入文档附件类型。** 不同于早期的 DocumentAttachmentRef 设计，文档就是 `mediaType` 落在已知文档集合中的文件。客户端继续使用 `addFiles()` 与 `kind: image | file` 草稿。

**抽取库，不是 Cordis 插件。** `@deepseek-ai/dsh-attachment-document` 本地定义 `DocumentMediaType` / `DOCUMENT_MEDIA_TYPES` / `isDocumentMediaType`，并导出 `extractText`（PDF 用 `pdf-parse`，DOCX 用 `mammoth`，类文本用 UTF-8）。LLM 请求组装经 `projectFilesForRequest` 把文档型持久 file 块展开为框定抽取文本；准入保留结构化 `file` 块供 UI 文件卡使用（见 [文件卡 / 请求侧展开](../bug-fix/2026-09-17-upload-document-file-card-request-expand.zh.md)）。非文档文件仍保留持久 file 引用，并投影为 handle 文本。

**S3 与本地存储。** 本地与 S3 后端把 `mediaType` 写进文件引用。S3 将 verbatim 文件放在 `v1/files/<sha>/<sha>`，图片对象仍在 `v1/objects/…`。

**BMP。** `ImageMediaType` 含 `image/bmp`。本地与 S3 存储准入 BMP；规范化对 BMP 不做透传（与 GIF 相同）。客户端 MIME 分流与 DeepSeek file-store 穷尽同一联合类型（见 [BMP 准入](2026-09-10-image-bmp-admission.zh.md)）。

## Alternatives considered

**DocumentAttachmentRef + saveDocument API** — 对 harness 拒绝：会分叉客户端上传路径，脱离 Worker 流式上传，并重复 UI 附件种类。

**准入时做 RAG / 向量索引** — 本切口拒绝：产品要求使用该上传的回合立刻可见文本。

**异步抽取与解析状态 UI** — 拒绝：超出同步注入合约的会话事件、轮询与失败面。

**在准入时把框定文本写入持久化用户消息** — 首切口曾落地，后已回退，以免聊天文件卡被抽取全文替换（见 [文件卡 / 请求侧展开](../bug-fix/2026-09-17-upload-document-file-card-request-expand.zh.md)）。

## Consequences

表格、PPT、EPUB 在声明类型时可被存储，但当前抽取会失败。无文本层的扫描 PDF 会失败。请求投影成功时，模型提示按抽取字符预算增大。非文档通用文件仍在请求组装时投影为 handle 文本。
