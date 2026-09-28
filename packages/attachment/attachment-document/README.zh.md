---
description: "从上传文档中抽取纯文本，供 LLM 请求投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-document

[English](README.md) | 中文

## 概述

从文档附件（PDF、DOCX 与常见文本格式）抽取纯文本，供 LLM 请求投影为模型框定截断后的文档内容。本包是 `dsh-llm` 请求组装使用的库，不注册 Cordis 服务。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在文档字节可用后调用 `extractText(data, mediaType, maxChars?)`。`dsh-llm` 在为一次 provider 请求投影持久 file 块时调用它。

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

抽取的纯文本由请求投影装入发给模型的文本内容块。持久会话日志保留结构化文件引用；对象键与存储路径不会进入框定文档正文。

#### Token effect

与截断后的抽取长度成正比；一份文档可在每次展开它的 provider 请求中，最多贡献配置字符预算对应的文本 token。

#### KV Cache effect

文档文本参与普通消息前缀；没有单独的文档缓存键。

不发布不变式伴生入口，因为本库不持有 Cordis 注册或可变共享状态；抽取是对调用方字节的纯函数。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **旧版 `.doc` 与 Office 二进制格式** — mammoth 面向 DOCX；更旧的二进制 Office 文件通常抽取失败。
- **表格、PPT、EPUB** — 附件后端可存储，但本包尚未抽取。
- **无 OCR** — 无文本层的扫描 PDF 会得到空抽取并被拒绝。
