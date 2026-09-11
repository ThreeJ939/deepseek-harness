# Agent Note: Mux 流拉取时重新进入鉴权 ALS

Status: implemented

[English](2026-09-04-mux-stream-als-rebind.md) | 中文

## 问题

多用户默认工作区 provision 在 `workspace.follow` 开头执行，并读取 `authMiddleware.getCurrentPrincipal()`（[provision 决策](../feature/2026-09-03-multi-user-default-workspace-provision.zh.md)）。Mux 升级仅在同步的 `handleUpgrade` 调用期间绑定 JWT 主体，随后把 `userId` 存进 `ConnectionMeta`。之后打开 `workspace.follow` 的逻辑流泵不在 ALS 内，因此 `provision()` 总是看不到主体并 no-op。同一路径上的按 owner 过滤的 `baseline()` 也有同样缺口。

## 决策

当 `openWireStream` 打开非 `$events` 的 Remote 流，且同时存在 `authMiddleware` 与 `ConnectionMeta.userId` 时，用 `bindAsyncIterableToPrincipal` 包装业务 iterable，使每次迭代器 `next` / `return` / `throw` 都在该升级绑定用户的 `runWithPrincipal` 内执行。`$events` 继续用连接 `userId` / `targetUserId` 过滤。保留 `session.control` 的显式 `viewerUserId` 注入。

## 后果

- 已鉴权的 live mux 上 `workspace.follow` 可用 ALS 做 provision 与 owner 过滤。
- 无 `userId` 的进程内 `wireStream.open` 行为不变（不重绑主体）。
- 依赖 `getCurrentPrincipal()` 的 Host 流处理器在 mux 路径上无需按端点注入载荷即可成立。

## 备选方案

- **像 `session.control` 一样向 `workspace.follow` 注入 `viewerUserId`** — 可行，但扩大 Remote 签名，且每个需要 ALS 的流都要重复一遍。
- **只给 `provision()` 增加显式 userId 参数** — 只修一个调用方；follow 时其它 ALS 读取仍坏。
- **连接生命周期使用 `AsyncLocalStorage.enterWith`** — Node 不鼓励的 API，且比按次拉取的 `run` 更难界定范围。

## 所需验证

- 单元：`bindAsyncIterableToPrincipal` 在 `next` 与 `return` 上恢复主体。
- Host mux：已鉴权升级 + `feed/whoami` 流条目等于升级时的 `userId`。
