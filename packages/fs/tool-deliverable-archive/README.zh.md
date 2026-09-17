---
description: "用 archive_deliverable 将工作区文件归档进持久附件存储；配置、Session 归属与下载引用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-deliverable-archive

[English](README.md) | 中文

## 概述

使用 `archive_deliverable` 将 Session 文件系统可访问的已有文件复制进已挂载的附件存储，以便 Web UI 下载不可变快照。工具记录路径、可选说明与 `FileAttachmentRef`。它不替代 `present`：`present` 继续声明可编辑的工作区源文件，且不复制字节。默认情况下，成功的 `present` 也会自动归档，因而无需模型再调一次即可出现 Web 下载。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`standard`、`ptc` 与 `cordis` Agent preset 挂载本插件。在 `autoArchiveAfterPresent`（默认 `true`）下，成功的 `present` 会在调用结算前归档同一批文件；归档失败会 block present 结果。仅在需要不 present 的不可变副本、或归档未 present 的文件时，以 `files: [{ path, description? }]` 调用 `archive_deliverable`。文件必须是 Session 文件系统可访问的普通文件。相对路径按 Session 工作目录解析。文件缺失、为目录、最终路径为符号链接或提供方拒绝访问时，调用失败。未挂载附件存储时也会失败（自动归档开启时还会 block present），并给出明确错误。

在 Agent 的 Cordis 组合中挂载，并提供 `tools`、`fs` 和 `turnBoundary` Session 投影；执行前挂载 `dsh-attachment-local` 或 `dsh-attachment-s3` 等附件提供方：

```yaml
- name: '@deepseek-ai/dsh-tool-deliverable-archive'
  config:
    maxFiles: 8
    autoArchiveAfterPresent: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxFiles` | `8` | 每次显式调用或自动归档批次的最大文件数，为正整数 |
| `autoArchiveAfterPresent` | `true` | 经 `tools/post-execute` 在成功的 `present` 上归档；失败则 block present |

挂载时校验文件数量上限。工具要求 Agent Session 具有工作区和尚未结束的轮次。归档归调用方 Session 所有。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

共享的 `archiveWorkspaceFiles` 通过配置的文件系统提供方解析路径，经 `readByteRange` 流式读取字节，并用 `attachments.saveFileStream` 提交。显式 `archive_deliverable` 的 execute 与 present 的 `tools/post-execute` 监听共用该助手。成功的最终 `tools/result` 通知追加 `deliverables/archived`，嵌套调用与自动归档的 present 执行也适用。被阻止的结果不发布声明。每个插件实例只记录其 pending 映射的调用。

当 `autoArchiveAfterPresent` 为 true 且存在 `systemPrompt` 时，一段固定提示词告知模型不要对同一批已 present 的文件再次归档。

纯 `./types` 入口声明 `ArchivedFile` 与 Session 事件，不导入 Host 运行时代码。Web 下载路由按 Session 事件坐标授权，而不是裸 attachment id。

**运行时不变式：** 不发布伴生入口。工具、post-execute、可选提示词与事件注册归 effect 所有；附件存储拥有文件字节，Session 日志拥有下载授权。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [文件系统子系统](../../../docs/subsystems/filesystem.zh.md)——提供方路径与错误。
- [附件子系统](../../../docs/subsystems/attachment.zh.md)——原文文件存储。
- [Web 交付](../../client/ui-deliverables/README.zh.md)——归档下载卡片与 Fetch 路由。
- [归档下载决策](../../../.agents/notes/implemented/feature/2026-09-14-deliverable-archive-download.zh.md)——与 present 分离及授权规则。
- [present 后自动归档](../../../.agents/notes/implemented/feature/2026-09-15-auto-archive-after-present.zh.md)——post-execute block 语义。

<a id="model-experience"></a>
## 模型体验

### archive_deliverable

#### 模型看到的内容

[archive_deliverable schema](../../../docs/tool-catalog.zh.md#archive_deliverable)要求已有且可访问的文件，并说明在自动归档开启时成功的 present 已会为 Web 下载归档。每个文件的结果为 `Archived <path> (<bytes> bytes)`；程序结果和持久事件包含路径、可选说明与附件引用。present 后的自动归档在 present 的 call id 下写入同一持久事件，不另起工具行。

#### Token 影响

每个挂载的 Agent 增加一个工具 schema；自动归档开启时增加一段可选固定提示词；每个显式归档文件增加一行结果。文件字节不进入模型消息。

#### KV Cache 影响

工具 schema 与可选提示词段落在挂载期间保持静态。归档结果文本扩展对话，不重写提示词前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 归档后的附件不会自动删除。
- 大文件经附件提供方流式传输；S3 提供方在提交时仍可能缓冲完整对象。
- 不签发预签名对象 URL；Web 下载经 Host Fetch 路由代理。
- present 后自动归档需要已挂载的附件存储；开关开启且缺失时，present 失败关闭。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
