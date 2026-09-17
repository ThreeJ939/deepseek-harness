# Agent Note: 上传文档在请求投影前仅显示为文件卡

Status: implemented

[English](2026-09-17-upload-document-file-card-request-expand.md) | 中文

## Problem

Prompt 准入把文档类上传替换成持久化的 `text` 块（`[Document: …]\n…`）。聊天 UI 会把用户消息里所有 `text` 拼进气泡，因此上传文档以抽取全文出现，而不是文件卡。

## Decision

会话日志中每次上传都保留 `{ type: 'file', attachment }`。仅在 LLM 请求组装时（`projectFilesForRequest`）把文档 MIME 展开为框定抽取文本；非文档仍用 handle 文本。不在持久化 file 块上增加 `extractedText`，也不抬升 `SESSION_FORMAT_VERSION`。抽取库与文档 MIME 集合仍由 [文档附件](../feature/2026-09-09-document-attachments-and-bmp.zh.md) 拥有。

## Alternatives considered

**恢复上游带 `extractedText` 的 `document` ContentBlock。** 本次修复拒绝：已发布格式校验只允许 `file` 含 `type` 与 `attachment`，且 harness 已采用 verbatim `file` 加请求侧 handle 投影。

**保留准入时展开，仅在 UI 隐藏文档文本。** 拒绝：模型可见正文仍会以 text 标签落在持久化用户消息里，与 MessageItem 的 text 拼接冲突。

## Consequences

新上传的文档在聊天中显示为文件卡。当 `mediaType` 为已知文档类型且附件字节可读时，模型仍收到抽取正文；否则收到路径 handle。已内联文档正文的历史消息不改写。Token 计量仍通过 `fileRequestText` 按同步 handle 计价。
