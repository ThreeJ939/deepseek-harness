# Agent Note: 以 JSON 编码 PostgreSQL 的 `surface_op`

Status: implemented

[English](2026-09-15-pg-surface-op-json-encoding.md) | 中文

## Problem

`dsh-session-persistence-pg` 写入 TEXT `surface_op` 时未 `JSON.stringify`，读回时也未 `JSON.parse`。`append` 字符串可以存活；replace 对象在列中变成 JSON 文本，再加载时仍是字符串。冷打开因此在校验处失败，报 `session event "system/message" carries an invalid surfaceOp`，于是会替换系统提示的多轮会话（包括已归档可下载交付物的会话）无法恢复。

## Decision

将 `surface_op` 按 JSON 文本编解码，与 SQLite 对齐。继续接受遗留的裸 `append` 字面量，使已写入的仅 append 行仍可读。不提升 `SCHEMA_VERSION`：node-pg 已存成 JSON 文本的 replace 行在 `JSON.parse` 后即可通过校验。

## Alternatives considered

**提升 schema 版本并重建库。** 拒绝：在解码兼容修复已能恢复遗留 append 与 JSON 文本 replace 时，重建会丢掉本地 platform 数据库。

**将 `surface_op` 改为 JSONB。** 推迟；TEXT 加 JSON 与 SQLite 列一致，且无需升 schema。

## Consequences

新写入存储带引号的 JSON `"append"`，而非裸 token。系统提示 replace 之后的恢复对新建行与此前无法加载的 replace 行均可用。官方上游仍仅 JSONL，不附带该提供方。
