---
description: "实验性宿主快路径：在 agent/pre-step 通过 yx-agent-router 执行已认领的设备意图，并跳过主模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-device-router-fastpath

[English](README.md) | 中文

## 概述

这个私有实验插件在 `agent/pre-step` 调用已发布的 `yx-agent-router` profile。当路由返回白名单内执行体的成功结果且意图明确时，插件把用户原文与一条短通知写入会话，并在不调用模型的情况下结束本轮。`unknown`、超时、传输失败，以及不在白名单中的执行体都会保持本轮决策不变，主智能体按原路径执行。

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

仅把该行挂到 **host** 组合（`--patch` 文件或宿主 overlay）。不要放进 agent preset：本插件决定主模型是否被调用。包是私有的，不得出现在发布包的 `dependencies` 中。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseUrl` | 必填 | `yx-agent-router` 源站，不带结尾斜杠 |
| `routerId` | 必填 | 已发布的路由 profile id |
| `timeoutMs` | `3000` | 分类+执行截止时间；超时则放行 |
| `claimedExecutors` | `['ability-gateway']` | `ok: true` 时结束本轮的执行体 id |
| `maxMessageChars` | `200` | 仍会调用路由的拼接真人文本最大 UTF-16 长度；更长则直接放行 |
| `headers` | `{}` | 额外请求头（例如网关 token） |

### 本地 `--patch`

```powershell
pnpm dsh --profile web --patch packages/experimental/device-router-fastpath/cordis.patch.yml
```

使用前先改该文件里的 `routerId`。同一挂载行也写在 [`packages/bundle/multi-user/LOCAL-DEV.zh.md`](../../bundle/multi-user/LOCAL-DEV.zh.md)。

### 路由侧前置条件

对专用的 `routerId`：

- `defaultExecutor` 必须是 `ability-gateway`，不能是 `openclaw`。
- 规则的 `fallback` 列表不得包含 `openclaw`。
- profile 必须已发布；未发布会使每次调用失败，本插件把它当作普通放行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

插件始终先调用 `next()`。随后只对包含 `source.kind === 'user'` 文本、且拼接长度不超过 `maxMessageChars` 的 `step === 1` 轮次分类。认领成功时追加这些真人消息与一条插件通知，并返回 `{ kind: 'enter', messages: [] }`，让循环在不打开 step 的情况下结束本轮。wire 客户端把失败归一为 `undefined`，并保持下游决策不变。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Config、认领策略、`agent/pre-step` 监听器 |
| [`src/client.ts`](src/client.ts) | 带 `deadline` 的 HTTP execute 调用与响应校验 |
| [`src/types.ts`](src/types.ts) | 本插件读取的已校验 wire 字段 |
| [`cordis.patch.yml`](cordis.patch.yml) | 可选宿主挂载示例 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent Note：device-router fail-open 快路径](../../../.agents/notes/implemented/architecture/2026-09-21-device-router-fastpath-fail-open.zh.md) — 认领白名单与实验组放置。
- [agent-loop README](../../core/agent-loop/README.zh.md) — `agent/pre-step` 空 enter 结束本轮。

-----

<a id="model-experience"></a>
## 模型体验

### 已认领的设备控制通知

#### 模型看到什么

认领成功的一轮中，会话收到原始用户消息以及一条插件来源通知，文本为 `[device control: <summary>]`（路由未给 summary 时回退为 intent）。该轮不发起模型请求。后续轮次中，该通知作为保留的 user 角色历史存在，呈现路径与模型切换通知相同。

#### Token 影响

认领成功的一轮不产生请求 token。保留通知长度受 `boundContextSummary`（120 字符）约束。放行的一轮不追加插件通知。

#### KV Cache 影响

认领成功的一轮不发送请求，因此不触及请求前缀。放行的一轮保持普通 agent-loop 前缀。之后的模型轮次会把该通知视为原始用户文本之后的 append-only 历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义本包覆盖与不覆盖的范围；它们是当前包约束，不是任务清单。

- **没有已发布 profile 挂载本插件** — 组合必须用显式宿主 patch 或 overlay 选择启用。
- **每条首步真人文本都会打路由** — 没有本地预筛；路由变慢时，非设备轮次会在关键路径上消耗配置的超时预算。
- **没有按 intent 区分的 UI 卡片** — 结果只有一条注入通知。
- **每个挂载实例只对应一个 `routerId`** — 多个路由需要多行插件。
- **未发布的路由配置会 fail-open** — 每次调用都会放行且没有用户可见错误；运维文档需检查发布状态。
- **`claimedExecutors` 是纵深防御，不能替代路由 profile 卫生** — OpenClaw 默认执行体仍须在路由侧修正。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
