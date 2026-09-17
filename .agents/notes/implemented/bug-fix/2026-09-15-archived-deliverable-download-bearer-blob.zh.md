# Agent Note：归档交付的鉴权 blob 下载

Status: implemented

[English](2026-09-15-archived-deliverable-download-bearer-blob.md) | 中文

## 问题

多用户 Host 要求每个 `/api` 请求携带 Bearer JWT。首版归档交付 Client 用未鉴权的 `HEAD` 外加裸 `<a download href>` 做 `GET`，因此在 `archive_deliverable` 成功后点击下载仍返回 401。

## 决策

将归档卡片 Client 改为对 `/api/deliverable.download` 发起带 `dsh.auth.jwt`（若存在）的 `Authorization: Bearer` 的 `GET`，把响应缓冲为 blob，再经临时 object URL 保存。遇到 HTTP 401 时清除已存 JWT 并派发共享的 auth-expired 事件，以便登录 UI 重新打开。Host 侧 `GET|HEAD` 流式响应保持不变。

## 考虑过的替代方案

**在下载 URL 上附加 `?access_token=`** 可让裸 `<a>` 通过 auth-middleware 且无需缓冲，但会把 JWT 暴露在历史记录、日志与 Referer 中。否决用于交付下载路径。

**HEAD 带 Bearer，随后未鉴权的 `<a>` GET** 在多用户鉴权下第二次请求仍会失败。否决。

## 影响

大归档会占用标签页内存。会话 ZIP 导出仍使用旧的 HEAD 再 `<a>` 模式，在 multi-user 下可能遇到同样的 401，直到采用相同载体。
