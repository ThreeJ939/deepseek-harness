---
description: "Experimental host fast path: claimed device intents run through yx-agent-router at agent/pre-step and skip the main model."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-device-router-fastpath

English | [中文](README.zh.md)

## Summary

This private experimental plugin calls a published `yx-agent-router` profile from `agent/pre-step`. When the router returns a successful allow-listed executor with a known intent, the plugin logs the original user text plus one short notice and ends the turn without a model call. Unknown intents, timeouts, transport failures, and non-allow-listed executors leave the turn unchanged so the main agent runs as usual.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row on the **host** composition only (a `--patch` file or host overlay). Do not put it inside an agent preset: the plugin decides whether the main model runs at all. The package is private and must not appear in release-package `dependencies`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | required | `yx-agent-router` origin without a trailing slash |
| `routerId` | required | Published router profile id |
| `timeoutMs` | `3000` | Classify-and-execute deadline; expiry falls through |
| `claimedExecutors` | `['ability-gateway']` | Executor ids whose `ok: true` result ends the turn |
| `maxMessageChars` | `200` | Max UTF-16 length of joined human text that still calls the router; longer turns fall through |
| `headers` | `{}` | Extra request headers (for example a gateway token) |

### Local `--patch`

```powershell
pnpm dsh --profile web --patch packages/experimental/device-router-fastpath/cordis.patch.yml
```

Edit `routerId` in that file before use. The same row is also documented in [`packages/bundle/multi-user/LOCAL-DEV.zh.md`](../../bundle/multi-user/LOCAL-DEV.zh.md).

### Router precondition

For the dedicated `routerId`:

- `defaultExecutor` must be `ability-gateway`, not `openclaw`.
- Rule `fallback` lists must not include `openclaw`.
- The profile must be published; an unpublished profile fails every call and this plugin treats that as ordinary fallthrough.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin always calls `next()` first. It then classifies only `step === 1` turns that contain `source.kind === 'user'` text whose joined length is at most `maxMessageChars`. A claim appends those human messages and one plugin notice, then returns `{ kind: 'enter', messages: [] }` so the loop closes the turn without opening a step. Failures resolve to `undefined` in the wire client and leave the downstream decision unchanged.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Config, claim policy, `agent/pre-step` listener |
| [`src/client.ts`](src/client.ts) | `deadline`-bounded HTTP execute call and response validation |
| [`src/types.ts`](src/types.ts) | Validated wire fields this plugin reads |
| [`cordis.patch.yml`](cordis.patch.yml) | Opt-in host mount example |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Note: device-router fail-open fast path](../../../.agents/notes/implemented/architecture/2026-09-21-device-router-fastpath-fail-open.md) — claim allow-list and experimental placement.
- [agent-loop README](../../core/agent-loop/README.md) — `agent/pre-step` empty-enter turn completion.

-----

<a id="model-experience"></a>
## Model Experience

### Claimed device-control notice

#### What the model sees

On a claimed turn the session receives the original user message(s) plus one plugin-sourced notice whose text is `[device control: <summary>]` (summary falls back to the intent when the router omits it). That turn makes no model request. On later turns the notice remains retained user-role history, the same presentation path as a model-switch notice.

#### Token effect

A claimed turn contributes zero request tokens. The retained notice length is bounded by `boundContextSummary` (120 characters). Fallthrough turns add no plugin notice.

#### KV Cache effect

Claimed turns send no request, so they do not touch the request prefix. Fallthrough turns keep the ordinary agent-loop prefix. A later model turn sees the notice as append-only history after the original user text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what the package does and does not cover; they are current package constraints, not a task backlog.

- **No shipped profile mounts this plugin** — compositions must opt in with an explicit host patch or overlay.
- **Every first-step human text call hits the router** — there is no local pre-filter; non-device turns pay the configured timeout budget on the critical path when the router is slow.
- **No per-intent UI card** — results are one injected notice only.
- **One `routerId` per mount** — multiple routers need multiple plugin rows.
- **Misconfigured unpublished router fails open** — every call falls through without a user-visible error; check router publish state in operations docs.
- **`claimedExecutors` is defense in depth, not a substitute for router profile hygiene** — an OpenClaw default executor must still be fixed on the router side.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
