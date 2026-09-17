---
description: "Zhishu 2.0 brand occupants for the Web client's sidebar and hero slots; for deployments replacing the official brand package."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-zhishu

English | [中文](README.zh.md)

## Summary

This private package fills the sidebar brand slots and the conversation hero mark with 智枢2.0 identity. Mount it instead of `@deepseek-ai/dsh-client-ui-brand-official` when the deployment is not DeepSeek Harness. It registers whenever the plugin is mounted — there is no `DSH_CLIENT_BUILD_PROFILE` gate. It has no runtime state and does not affect model requests.

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

Replace the official brand row in the browser roster with this package, serve `/zhishu-icon.svg` from the web app public assets, and set `DSH_CLIENT_TITLE` (and matching favicon / PWA manifest) to the same product name.

### Replacing the official brand

Occupying `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` is the only composition route. Leave `dsh-client-ui-brand-official` out of the same roster so two brand occupants do not compete.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The three occupants install as one declaration-aware registration set: nested `ctx.slots.inject()` calls wait on each declaration, so the set works whether this row activates before or after the declarers, withdraws every occupant when a declaration collapses, and leaves no partial brand mix during HMR. The mark is a static `<img>` of `/zhishu-icon.svg`; the name reads `DSH_CLIENT_TITLE` with a 智枢2.0 default. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [ui-brand-official](../ui-brand-official/README.md) — the DeepSeek Harness occupants this package replaces.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.
- **Mark bytes are web-app assets** — this package references `/zhishu-icon.svg`; the file itself lives under `apps/web/public/`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its three slot occupants install and leave through one transactional effect.
