# Agent Note：成功 present 后自动归档

Status: implemented

[English](2026-09-15-auto-archive-after-present.md) | 中文

## 问题

Web 与多用户场景在模型 present 文件后需要「下载」操作。依赖第二次显式 `archive_deliverable` 会使仅 present 的轮次没有归档卡。更早的归档下载笔记为保持模型可见步骤而否决了 Host 自动归档；产品体验随后要求在常见的 present 路径上反转该决定。

## 决策

保持 `present` 与 `archive_deliverable` 为独立工具。在 [`dsh-tool-deliverable-archive`](../../../../packages/fs/tool-deliverable-archive/README.zh.md) 中，当 `autoArchiveAfterPresent` 为 true（默认）时，`tools/post-execute` 监听器用与显式工具相同的 `archiveWorkspaceFiles` 助手归档成功的 `present`。归档失败返回 `{ kind: 'block' }`，因而 present 变为 `isError`，且不追加 `deliverables/presented` 与 `deliverables/archived`。成功则把 pending 归档挂在 present 执行上，由既有的 `tools/result` 监听器用 present 的 `callId` 追加 `deliverables/archived`。

## 考虑过的替代方案

**让 `present` 自身写入附件**会把可编辑源文件声明与持久副本耦进 `tool-present`。否决；监听留在归档包内（方案 B）。

**仅把 archive 写成 must 文案**仍依赖模型合规。否决，以保证 Web 下载可靠性。

**在 `tools/result` 后尽力归档**无法使 present 失败，会留下有 presented 无下载的轮次。否决，改用 `post-execute` block。

## 影响

以默认开关挂载本插件的部署，成功 present 需要附件存储。运维可将 `autoArchiveAfterPresent` 设为 `false`。显式 `archive_deliverable` 仍用于不 present 的归档。这仅在 present 成功路径上反转了[交付归档下载](2026-09-14-deliverable-archive-download.zh.md)中「不做 Host 自动归档」的替代方案。
