# Agent Note：交付归档与鉴权 Web 下载

Status: implemented

[English](2026-09-14-deliverable-archive-download.md) | 中文

## 问题

云端多用户部署把持久字节放在兼容 S3 的附件存储中，但 `present` 只声明工作区源路径、不复制内容。远程浏览器无法打开 Host 桌面应用，容器或用户工作区清理后工作区文件也会消失。需要在不改动“可编辑源文件交付”约定的前提下，提供可下载的不可变副本。

## 决策

交付独立工具 `archive_deliverable`，位于 [`dsh-tool-deliverable-archive`](../../../../packages/fs/tool-deliverable-archive/README.zh.md)。它经 `saveFileStream` 把工作区文件字节流入 `ctx.attachments`，并在成功的最终工具结果后追加带 `FileAttachmentRef` 的 `deliverables/archived`。`present` 仍作为可编辑源文件声明保持不变。默认情况下归档插件还通过 `tools/post-execute` 自动归档成功的 `present`（[present 后自动归档](2026-09-15-auto-archive-after-present.zh.md)）。

[`dsh-client-ui-deliverables`](../../../../packages/client/ui-deliverables/README.zh.md) 注册 `GET|HEAD /api/deliverable.download?sessionId=&seq=&index=`。路由按坐标读取归档事件、校验文件条目，并以 `Content-Disposition: attachment` 流式返回 `attachments.readFileStream`。授权要求附件引用出现在 Session 日志中；拒绝裸 `attachmentId` 查询参数，避免内容寻址摘要被跨租户猜测。浏览器半部渲染带「下载」操作的归档卡片：在存在多用户 Bearer JWT 时附带该头发起 `GET`，物化为 blob，再经临时 object URL 保存。

`standard`、`ptc` 与 `cordis` preset 在 present 旁挂载归档工具。平台部署继续通过 `dsh-attachment-s3` 提供 S3；本地附件存储仍可用于开发。

## 考虑过的替代方案

**改写 `present` 默认入库**会推翻已交付的可编辑源文件决策，并把打开与快照绑成单一产品语义。否决，以便 present 卡片继续对活工作区文件做侧栏预览与 Host 原生打开。

**每次成功 present 后由 Host 自动归档**最初为保持显式、模型可见的工具而被否决。该替代方案后来仅在 present 成功路径上被反转；见[present 后自动归档](2026-09-15-auto-archive-after-present.zh.md)。

**预签名 S3 URL**可降低 Host 带宽，但当前附件 seam 无此封装，且多租户过期策略更复杂。延期；第一版像会话 ZIP 导出一样经鉴权 Fetch 路由代理。

**第二个 artifact 服务**会重复附件存储。否决；原文文件附件已提供内容寻址持久化。

## 影响

含 `deliverables/archived` 的会话要求读者识别该事件类型。下载依赖已挂载的附件存储；缺失时工具失败关闭，且不注册下载路由。附件不会自动删除。会话 ZIP 导出已会流式打包被引用的文件附件；归档交付物经同一存储参与。

## 必要验证

- 归档成功、校验失败、缺少 attachments、取消的 Host 单测。
- 坐标校验、Content-Disposition、404 的 Host Fetch 路由测试。
- `deliverables/archived` 轮次折叠、归档卡片与下载预检的 Client 测试。
- `standard` / `ptc` / `cordis` 的 preset 接线。
- 工具目录重新生成包含 `archive_deliverable`。
