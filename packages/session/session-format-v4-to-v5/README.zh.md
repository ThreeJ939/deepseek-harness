---
description: "近恒等的 Session V4 到 V5 迁移：可选 ownerUserId 头字段接纳，事件体保持不变。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

[English](README.md) | 中文

## 摘要

在不改写已存储代际的前提下，将受支持的已发布 V4 Session 还原为 V5。该边推进 header 版本并接纳可选的 `ownerUserId`；事件体、run、坐标与继承切点原样透传。持久化负责文件读取与后继发布；本库负责转换与目标规则。

## 目录

- [使用本包](#use-this-package)
- [V4 到 V5 规范](#v4-to-v5-specification)
  - [Header 与物理分帧](#header-and-framing)
  - [事件与 run 透传](#event-passthrough)
  - [投递代际](#delivery-guards)
  - [源审计与拒绝](#source-audit)
- [原生 V5 接纳](#native-v5-admission)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

完整还原使用[目录](../session-format-catalog/README.zh.md)。直接导入服务于目录装配与测试；本库没有 Cordis 挂载配置。其[公共导出](src/index.ts)提供相邻迁移、已发布 V4 源 codec、V5 codec 与目标校验器。源 codec 仍由 [V3 到 V4](../session-format-v3-to-v4/README.zh.md) 拥有。

仅 header 迁移会校验并推进元数据，不读取事件体：

```text
const targetHeader = sessionFormatV4ToV5.migrateHeader(sourceHeader)
```

体还原为每个工件创建独立 Stage 状态。紧凑 run 以可迭代方式展开，不物化中间事件数组。[格式协议](../session-format/README.zh.md)负责调度与错误处理；[JSONL 持久化](../session-persistence-jsonl/README.zh.md)负责源读取、准备与已验证的独占后继发布。

-----

<a id="v4-to-v5-specification"></a>
## V4 到 V5 规范

该边只更改 header 的版本字段，不转换事件载荷、消息身份、坐标或 catalog 事实。更早的 V0–V3 输入先经既有边到达 V4；那些边保留各自的转换与拒绝策略。

<a id="header-and-framing"></a>
### Header 与物理分帧

| 输入 | V5 结果 | 保留或拒绝 |
|---|---|---|
| 逻辑 V4 header | `version: 4` 变为 `5` | 先运行已发布 V4 header 校验；其余逻辑 header 字段保持不变。已发布 V4 header 不携带 `ownerUserId`。 |
| V4 物理行 | 已发布 V4 源 codec 解码事件与紧凑 run | 源分帧与 source-event 范围解码仍由前序包拥有。 |
| V5 物理行 | `releasedV5SessionFormatCodec` 复用已发布 V4 分帧并执行原生 V5 header 接纳 | 编码和解码不运行此入边迁移。 |

<a id="event-passthrough"></a>
### 事件与 run 透传

每个被接纳的源事件以其原始对象身份、`seq`、`time`、`type`、`data` 与可选信封字段发出。仅在 stage 没有直接 run 处理时展开紧凑 run；值保持不变。恒等转换下继承切点数值相同。稀疏源序列拒绝。

<a id="delivery-guards"></a>
### 投递代际

声称 `sessionFormatVersion: 5` 的 V4 源投递标记在发出前拒绝。前代与无关代际标记原样透传。原生 V5 还原只激活 `sessionFormatVersion` 等于 `5` 的标记。

<a id="source-audit"></a>
### 源审计与拒绝

| 源条件 | 结果 |
|---|---|
| 含意外成员的已发布 V4 header | 迁移前格式错误 |
| 稀疏事件序列 | 格式错误 |
| 未播种日志含继承 end-seed | 格式错误 |
| 播种切点与最终继承标记不一致 | 格式错误 |
| 投递标记声称目标 V5 | 不支持的迁移拒绝 |

未知的必选或可忽略事件词汇在 header 推进后仍由已发布 V4 还原与已安装 Session 包拥有。

-----

<a id="native-v5-admission"></a>
## 原生 V5 接纳

原生 V5 header 要求已发布 V4 字段，并可选接纳非空字符串 `ownerUserId`。空或非字符串 owner id 拒绝。事件体接纳、生命周期关系与已退役语法复用已发布 V4 校验器；当前代际投递标记只在版本 `5` 激活。

`assertReleasedV5Header` 校验逻辑元数据。`restoreReleasedV5Artifact` 校验继承、词汇、V4 体规则与 V5 投递所有权。`releasedV5SessionFormatCodec` 仅在 header 上编码和解码带可选 owner 字段的物理行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

[`src/migration.ts`](src/migration.ts) 拥有相邻声明与恒等 stage。[`src/codec.ts`](src/codec.ts) 包装已发布 V4 codec，并在逻辑 header 上恢复 `ownerUserId`。[`src/validation.ts`](src/validation.ts) 拥有 V5 header 与投递检查，并复用已发布 V4 体校验器。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Session 格式目录](../session-format-catalog/README.zh.md)
- [V3 到 V4 规范](../session-format-v3-to-v4/README.zh.md)
- [添加 Session 格式版本](../../../docs/cookbook/adding-a-session-format-version.zh.md)

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

该边不重命名事件、不改写 tool result，也不补全父 catalog。结构性体变更需要后续相邻版本。历史 V4 归档仍不含 `ownerUserId`；只有原生 V5 写入器会盖上该字段。

<a id="dev-note"></a>
## 开发笔记

无。
