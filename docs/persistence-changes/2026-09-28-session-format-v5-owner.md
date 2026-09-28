---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-28-session-format-v5-owner

English | [中文](2026-09-28-session-format-v5-owner.zh.md)

## Summary

Advances SessionHeader.version from 4 to 5 for optional multi-tenant ownerUserId, and adds the deliverables/archived Session event for durable archived file attachments.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-28-session-format-v5-owner
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "4949a26923aeeb93edc2ad370dfcaffca1aa4372dd4a5cabf13568bda82fe4f7"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "f233d64e1795eeec9611889361f1a1f06393f8eef898b04cc76635d9bb5ed79d"
    decision: version-bump
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "3bc0eea00f7c98146f88e6aba80ee619add8d3319e34804c99b5458dcf2b9189"
    decision: version-bump
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "d37a5aea5f9e8605c0c24803358c53d432fd96df9c6584588c7bc251343d03a5"
    decision: version-bump
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "31e8faf47c745a1949fc91be75ccbc16f071cf344a9a00963b69f07528027744"
    decision: version-bump
  - root: "event:deliverables/archived"
    previous: null
    after: "a97b5cc1d9f327c15155fdbe41275223b5ea12a5eaf95e36d9ef02c7c6ed0714"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "e51003712424d604746280d7f5e80e61049e1246b1f9cc33b593c7eaa478c6a4"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "d26cd97084186c9a908ad9a9a1cc1a0e836fce13f78beb1a382599f6bc886538"
    decision: version-bump
  - root: "event:system/message"
    previous: "2026-09-16-session-format-v4"
    after: "c2b73689381af616117e16dfdae3ff1b428c7fb01b75bfc6c2b5b94c6d99d800"
    decision: version-bump
  - root: "event:team/message/queued"
    previous: "2026-09-16-session-format-v4"
    after: "b673be532b906706af2ce21e6bbb77852268e0cb5c8e2c9d8ccef2c2c019ac17"
    decision: version-bump
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-16-session-format-v4"
    after: "d27a5e24c2e6d141a32c04415bea45e700a4583ef4e4af7c8c972a7f2d14196d"
    decision: version-bump
  - root: "event:tool/result"
    previous: "2026-09-16-session-format-v4"
    after: "d8efc59ebcc3a9f694f2bf726967ca88256790293534f7201843d10914565f5d"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "b0e1fcc6e5a3470559da923f8bc618a0ebf5d76bc6c3e83f8d6f13ce8dd1a52a"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

V4 readers refuse the newer generation. The near-identity V4-to-V5 migration advances headers to version 5 and passes admitted events through; optional ownerUserId is absent on migrated historical headers until a multi-user writer stamps it. Existing V4 Session files remain readable through the adjacent chain. The new deliverables/archived event is ignorable to older equal-version readers that do not declare it; V5 writers emit it from archive_deliverable and auto-archive after present. Shared ContentBlock and MessageSource declarations also advance in this writer bump because attachment and related producer types evolve in the same checkout, so several message-bearing event digests change without independent event protocols.

<a id="verification"></a>
## Verification

pnpm run verify-persistence-formats; pnpm run gen-persistence-catalog; packages/deliverables/tool-deliverable-archive tests and packages/session/session-format-v4-to-v5 migration coverage.

<a id="dev-note"></a>
## Dev Note

None.
