---
description: "从上传文档中抽取纯文本，供模型提示词注入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-document

[English](README.md) | 中文

## 概述

从已准入的文档附件（PDF、DOCX 与常见文本格式）抽取纯文本，供 Host 提示词准入把截断后的文档内容注入用户消息。本包是会话与子代理提示词路径使用的库，不注册 Cordis 服务。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在文档字节校验通过后调用 `extractText(data, mediaType, maxChars?)`。当提示词可能包含文档部分时，将其作为 `extractDocumentText` 传给 `admitPromptContent`。

<a id="understand-the-implementation"></a>
## 理解实现

| 格式 | 抽取器 |
|---|---|
| PDF | `pdf-parse` |
| DOCX / DOC | `mammoth` |
| 纯文本、JSON、Markdown、CSV、SQL、Java 源码 | UTF-8 解码 |

抽取结果按字符预算截断（默认 50_000）后返回。

<a id="model-experience"></a>
## 模型体验

### Document text injection

#### What the model sees

抽取的纯文本由 Host 装入用户消息中的文本内容块。对象键与存储路径不会进入提示词。

#### Token effect

与截断后的抽取长度成正比；一份文档可在包含它的首轮及后续重放该用户消息的轮次中，最多贡献配置字符预算对应的文本 token。

#### KV Cache effect

文档文本参与普通消息前缀；没有单独的文档缓存键。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **旧版 `.doc` 与 Office 二进制格式** — mammoth 面向 DOCX；更旧的二进制 Office 文件通常抽取失败。
- **表格、PPT、EPUB** — 附件后端可存储，但本包尚未抽取。
- **无 OCR** — 无文本层的扫描 PDF 会得到空抽取并被拒绝。
