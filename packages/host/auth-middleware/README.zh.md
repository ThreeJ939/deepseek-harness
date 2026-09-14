# @deepseek-ai/dsh-host-auth-middleware

English | [中文](README.md)

DeepSeek Harness Web 宿主的 JWT 鉴权中间件。激活时在 `ctx.webServer` 上注册路由前 `WebMiddleware`：要求 `Authorization: Bearer <token>`，用 `jose` 校验 HS256，把 `AuthenticatedPrincipal`（`userId` 来自 JWT `sub`）写入 AsyncLocalStorage，缺 token 或无效时返回 `401`。下游通过 `ctx.authMiddleware.getCurrentPrincipal()` 读取主体。WebSocket 升级经 `authenticateRequest` + `runWithPrincipal` 鉴权（由 `dsh-client-connection` 调用）。

## 配置

- `jwtSecret` — HMAC 密钥（至少 32 字符）。省略时回落到 `DSH_JWT_SECRET`。
- `audience` / `issuer` — 可选的 JWT claim 校验。

与 [`dsh-multi-user`](../../bundle/multi-user/README.zh.md) bundle 一起挂载。单用户 profile 不挂本插件；无 principal 时网关所有权检查保持关闭。

## 模型体验

无；本包只鉴权 HTTP 与 upgrade 请求。

不发布不变式伴生入口，因为鉴权是请求作用域的 ALS 状态，而非持久注册表关系。

## 已知限制与延后工作

- **仅 HS256** — 非对称或多 issuer 需后续 provider。
- **无 refresh / session cookie** — 每次 HTTP 与 upgrade 都需 Bearer token。
