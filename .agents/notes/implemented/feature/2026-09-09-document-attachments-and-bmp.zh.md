# Agent Note: Document attachments with sync text injection and BMP images

Status: implemented

English | [中文](2026-09-09-document-attachments-and-bmp.md)

## Problem

Composer 入口原先只接受光栅图。产品聊天需要文档上传：原样存储文件、在 prompt 准入时同步抽取纯文本，并注入用户消息，使不支持文档模态的模型仍可读到内容。RAG、异步解析状态、跨会话「我的文件」库不在本切口范围。

## Decision

**统一文件路径，可选 mediaType。** harness 对非图片上传保持单一的 verbatim `FileAttachmentRef` / `saveFileStream` 路径。`FileAttachmentRef` 与 `SaveFileStreamAttachment` 的可选 `mediaType` 把浏览器声明的 MIME 经 Worker 上传查询参数写入存储与持久引用。

**不单独引入文档附件类型。** 不同于早期的 DocumentAttachmentRef 设计，文档就是 `mediaType` 落在已知文档集合中的文件。客户端继续使用 `addFiles()` 与 `kind: image | file` 草稿。

**抽取库，不是 Cordis 插件。** `@deepseek-ai/dsh-attachment-document` 本地定义 `DocumentMediaType` / `DOCUMENT_MEDIA_TYPES` / `isDocumentMediaType`，并导出 `extractText`（PDF 用 `pdf-parse`，DOCX 用 `mammoth`，类文本用 UTF-8）。session-controller 的 `expandDocumentFiles` 读取已准入的文档型文件，并在 `createUserMessage` 前替换为带框的文本块。非文档文件仍保留持久 file 引用。

**S3 与本地存储。** 本地与 S3 后端把 `mediaType` 写进文件引用。S3 将 verbatim 文件放在 `v1/files/<sha>/<sha>`，图片对象仍在 `v1/objects/…`。

**BMP。** `ImageMediaType` 含 `image/bmp`。本地与 S3 存储准入 BMP；规范化对 BMP 不做透传（与 GIF 相同）。客户端 MIME 分流与 DeepSeek file-store 穷尽同一联合类型（见 [BMP 准入](2026-09-10-image-bmp-admission.zh.md)）。

## Alternatives considered

**DocumentAttachmentRef + saveDocument API** — 对 harness 拒绝：会分叉客户端上传路径，脱离 Worker 流式上传，并重复 UI 附件种类。

**准入时做 RAG / 向量索引** — 本切口拒绝：产品要求同一条用户消息内立刻可见文本。

**异步抽取与解析状态 UI** — 拒绝：超出同步注入合约的会话事件、轮询与失败面。

**仅在 LLM 投影时抽取** — 本切口拒绝：文档在会话日志与模型侧应对齐为同一段带框文本。

## Consequences

表格、PPT、EPUB 在声明类型时可被存储，但当前抽取会失败。无文本层的扫描 PDF 会失败。重放该用户消息的回合会按抽取字符预算增大模型提示。非文档通用文件仍在请求组装时投影为 handle 文本。
