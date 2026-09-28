# Agent Note: Device-router fail-open 快路径

Status: implemented

[English](2026-09-21-device-router-fastpath-fail-open.md) | 中文

## 问题

需要开关级体感的设备控制轮次仍会进入完整 agent loop，并支付主模型往返。外部 `yx-agent-router` 已能分类并执行这些意图，但 harness 缺少一个能在模型请求前结束本轮、同时让普通对话继续走现有智能体的宿主接点。

## 决策

`@deepseek-ai/dsh-experimental-device-router-fastpath` 挂在 host 上并监听 `agent/pre-step`。在 `next()` 之后，它只对首步真人文本调用 `POST /router/v1/{routerId}/execute`，并把 DSH `SessionId` 作为 `sessionUser`。认领要求 `ok === true`、`route` 属于 `claimedExecutors`，且意图不是 `unknown`。认领成功时追加真人消息与一条插件通知，并返回空的 `enter`，让循环在不调用模型的情况下完成本轮。其余结果——超时、传输失败、schema 不匹配、unknown、或不在白名单的 route——都保持决策不变（fail-open）。

该包留在 `packages/experimental/`：公开约定随部署变化、保持私有，且不是稳定能力 seam。`claimedExecutors` 是防止路由把 `unknown` 委派给 OpenClaw 的纵深防御；专用路由 profile 仍须把 `defaultExecutor` 设为 `ability-gateway`，并在 fallback 中排除 OpenClaw。

## 考虑过的替代方案

**仅靠主智能体设备工具。** 适合复杂多步请求，但每条短指令仍要支付完整模型轮次，达不到延迟目标。

**在 `agent/request` 内分类。** 太晚：循环已进入预期模型调用的 step 路径；`agent/pre-step` 是唯一能用空首批结束本轮的 waterfall。

**路由错误时 fail-closed。** 路由宕机或未发布时会挡住普通对话；fail-open 保持现有智能体可用。

**稳定能力 seam（Service Definition / Provider / Consumer）。** 在唯一消费者仍是私有宿主 patch、且路由 API 仍是外部部署面时过早。

## 后果

宿主组合可用 `--patch` 行选择启用。认领成功的轮次追加保留通知并跳过模型。非设备轮次最多支付 `timeoutMs` 的路由往返。未发布或默认 OpenClaw 的路由 profile 会静默落入主智能体，除非运维修正 profile。
