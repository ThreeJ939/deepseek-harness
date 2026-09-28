---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-28-session-format-v5-owner

[English](2026-09-28-session-format-v5-owner.md) | 中文

## 概述

将 SessionHeader.version 从 4 提升到 5，以支持可选的多租户 ownerUserId，并新增 deliverables/archived Session 事件以持久化归档文件附件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

V4 读取器拒绝更新的代际。近恒等的 V4 到 V5 迁移将 header 推进到版本 5 并透传已准入事件；迁移后的历史 header 在多用户写入器盖章之前不带可选 ownerUserId。现有 V4 Session 文件仍可通过相邻迁移链读取。新的 deliverables/archived 事件对未声明它的同版本旧读取器可忽略；V5 写入器由 archive_deliverable 与 present 后的自动归档发出。同一检出中的附件及相关生产者类型演进也使共享 ContentBlock 与 MessageSource 声明在此次写入器提升中前进，因此多个携带消息的事件摘要发生变化，但并不各自形成独立事件协议。

<a id="verification"></a>
## 验证

pnpm run verify-persistence-formats；pnpm run gen-persistence-catalog；packages/deliverables/tool-deliverable-archive 测试与 packages/session/session-format-v4-to-v5 迁移覆盖。

<a id="dev-note"></a>
## 开发备注

无。
