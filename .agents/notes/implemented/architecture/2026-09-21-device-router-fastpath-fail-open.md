# Agent Note: Device-router fail-open fast path

Status: implemented

English | [中文](2026-09-21-device-router-fastpath-fail-open.zh.md)

## Problem

Device-control turns that must feel switch-like still enter the full agent loop and pay a main-model round trip. An external `yx-agent-router` already classifies and executes those intents, but the harness had no host seam that could end a turn before a model request while keeping ordinary chat on the existing agent.

## Decision

`@deepseek-ai/dsh-experimental-device-router-fastpath` mounts on the host and listens to `agent/pre-step`. After `next()`, it classifies only first-step human text through `POST /router/v1/{routerId}/execute`, using the DSH `SessionId` as `sessionUser`. A claim requires `ok === true`, `route` in `claimedExecutors`, and a non-`unknown` intent. On claim it appends the human messages and one plugin notice, then returns an empty `enter` so the loop completes the turn without a model call. Every other outcome — timeout, transport failure, schema mismatch, unknown intent, or a non-allow-listed route — leaves the decision unchanged (fail-open).

The package stays in `packages/experimental/`: the public contract is deployment-specific, private, and not a stable capability seam. `claimedExecutors` is defense in depth against a router profile that delegates `unknown` to OpenClaw; the dedicated router profile must still set `defaultExecutor` to `ability-gateway` and omit OpenClaw from fallbacks.

## Alternatives considered

**Main-agent device tools only.** Correct for complex multi-step requests, but every short command still pays a full model turn, which misses the latency goal.

**Classify inside `agent/request`.** Too late: the loop has already committed to opening a step path that expects a model call; `agent/pre-step` is the only waterfall that can end a turn with an empty first batch.

**Fail closed on router errors.** Would block ordinary chat when the router is down or unpublished; fail-open keeps the existing agent available.

**Stable capability seam (Service Definition / Provider / Consumer).** Premature while the only consumer is one private host patch and the router API remains an external deployment surface.

## Consequences

Host compositions can opt in with a `--patch` row. Claimed turns add retained notice text and skip the model. Non-device turns pay the router round trip up to `timeoutMs`. Unpublished or OpenClaw-default router profiles fail silently into the main agent unless operators fix the profile.
