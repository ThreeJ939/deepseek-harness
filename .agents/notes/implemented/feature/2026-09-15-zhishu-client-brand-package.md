# Agent Note: Zhishu brand package for Web white-label

Status: implemented

English | [中文](2026-09-15-zhishu-client-brand-package.zh.md)

## Problem

White-label deployments need a product mark and name other than DeepSeek Harness. Mutating `FishLogo`, `ui-brand-official`, or the conversation hero fallback couples fork identity to upstream presentation and breaks the documented replacement path.

## Decision

Ship a private `@deepseek-ai/dsh-client-ui-brand-zhishu` package that occupies `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` whenever it is mounted. The mark is a static `/zhishu-icon.svg` image from `apps/web/public/`; the name reads `DSH_CLIENT_TITLE` with a 智枢2.0 default. The `web-app` bundle mounts this package instead of `dsh-client-ui-brand-official`. Browser title, favicon, and PWA manifest remain build/surface concerns outside the slot system. The multi-user login gate in `dsh-client-ui-auth` uses the same public mark and 智枢2.0 locale titles because that surface hard-codes its hero rather than a brand slot.

## Alternatives considered

**Patching official brand primitives in place** would white-label every consumer of those packages and fight upstream merges. Rejected; the official package README already requires a replacement occupant package.

**Profile-gating on `DSH_CLIENT_BUILD_PROFILE=official`** matches the DeepSeek package but would hide Zhishu identity under local builds. Rejected for a deployment whose only shipped Web identity is 智枢2.0.

**Inlining brand JSX in `web-app`** would skip the slot composition model and duplicate declaration-aware registration. Rejected.

## Consequences

`ui-brand-official` remains in the repository for upstream/test assemblies that still mount it. Slot-catalog generation may list both packages as occupants. Desktop `productName` and welcome / DeepSeek API-key onboarding copy that still say DeepSeek Harness are out of this change's scope.

## Required verification

- Package unit tests for registration, teardown, and mark/name rendering.
- `web-app` cordis patch and dependency swap to the Zhishu package.
- Existing surface checks for title / favicon / manifest remain aligned with 智枢2.0.
- `ui-auth` login gate shows the Zhishu mark and product title.
