# Agent Note: 文件上传原始路由携带多用户 JWT

Status: implemented

[English](2026-09-10-file-upload-jwt-auth.md) | 中文

## Problem

在 `dsh-multi-user` 下，`auth-middleware` 要求 `/api` 请求携带 Bearer JWT（或 WebSocket `access_token`）。Connection RPC 与 Gateway mux 会从 `sessionStorage['dsh.auth.jwt']` 附加 token。文件上传 Client 原始路由（`POST /api/session/uploadFileBinary`）只发送 `content-type: application/octet-stream`，因此已鉴权部署返回 HTTP 401，作曲器对每个非图片附件显示上传失败。

## Decision

**在原始文件上传上附加同一份已存 JWT。** `FileUploadRuntime.upload` 在 Worker 或页面自有 Fetch 载体执行前，用可选的 `Authorization: Bearer <jwt>` 组装请求头。HTTP 401 清除已存 token 并派发 `dsh-auth-expired`，与 Connection RPC 恢复路径一致。辅助函数留在 Client runtime 本地（key / 事件名与 Connection、Gateway stream client 相同），避免 Client face 依赖 Host connection 入口。

## Alternatives considered

**仅依赖 cookie / `withCredentials`** — 拒绝：多用户 token 在 `sessionStorage`，不是 HttpOnly cookie。

**强制所有上传走 Typert Remote unary** — 拒绝：Blob 进度与 stream 转移需要专用原始路由与 Worker。

## Consequences

多用户 web profile 可再次暂存 PDF 等非图片文件。没有已存 JWT 的单用户 profile 保持原先请求头。提供 `__DSH_FILE_UPLOAD__` 的调用方仍会在其执行的 RequestInit 上收到 Authorization 头。
