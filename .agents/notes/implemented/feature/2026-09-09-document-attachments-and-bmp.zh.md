# Agent Note：文档附件同步文本注入与 BMP 图片

状态：implemented

[English](2026-09-09-document-attachments-and-bmp.md) | 中文

## 问题

Composer 输入此前只接受光栅图片（且不含 BMP）。产品聊天需要并行的文档上传路径：存储原文件，在准入时同步抽取纯文本，并注入用户消息，使没有文档模态的模型仍能读到内容。RAG、异步解析状态与跨会话「我的文件」库不在本切范围内。

## 决策

**图片路径支持 BMP。** `ImageMediaType` 包含 `image/bmp`。本地与 S3 存储准入 BMP；归一化将 BMP 与 GIF 一样按透传处理（不重压缩）。客户端 MIME 校验与 DeepSeek file-store 穷尽同一联合类型。

**附件缝上的文档词汇。** `DocumentMediaType`、`DocumentAttachmentRef`、`DocumentAttachmentLimits`、编码/保存文档类型，以及 `PromptContentPart` / `AdmittedPromptContentPart` 的 `document` 分支，放在 `@deepseek-ai/dsh-attachment`。`AttachmentStore` 增加批量 `saveDocuments` / `readDocument` 与可选 `documentLimits`；未提供限额的 provider 拒绝文档批次。

**存储键。** 本地落在 `documents/`；S3 使用内容寻址的 `v1/documents/<sha>/<sha>`。

**抽取库而非 Cordis 插件。** `@deepseek-ai/dsh-attachment-document` 导出 `extractText`（PDF 用 `pdf-parse`，DOCX 用 `mammoth`，类文本类型 UTF-8 解码）。session-controller 与 subagent 提示词路径把它作为 `extractDocumentText` 传入 `admitPromptContent`。`admittedPartsToContentBlocks` 把文档部分变成带框文本块；不新增 LLM `ContentBlock` 类型。

**客户端体验。** Composer 草稿为 `image | document` 联合，复用现有 `imageIds` 飞行列表。InputBar 增加文档选择器；`ComposerAttachments` 渲染文档芯片并把拖放拆成图片与非图片批次。`documentLimits` 与 `imageLimits` 一并投影，供加入预检与错误文案。仅文档发送在 prompt 成功后释放草稿；混合发送立刻释放文档，图片仍走 image echo 退役。

## 备选方案

**准入时做 RAG / 向量索引** — 本切否决：产品要求同一条用户消息内立刻对模型可见文本，而非语料检索。

**异步抽取加解析状态 UI** — 否决：会引入会话事件、轮询与超出同步注入契约的失败面。

**单独的 Cordis 文档服务** — 在只需一个抽取器时否决；调用方在准入调用点注入 `extractText`。

**新增文档模型内容块类型** — 否决，使每条模型路径都能消费带框文本而无需改 provider。

## 后果

白名单内的表格、PPT、EPUB 可能被存储，但当前抽取会失败。无文本层的扫描 PDF 会失败。模型提示词在重放该用户消息的轮次上，每份文档最多增加 `maxExtractedCharsPerDocument`。keyless 演示若要覆盖加入预检文案，fixture 传输应镜像 `documentLimits`。
