# @deepseek-ai/dsh-host-auth-login

[English](README.md) | 中文

多用户 dsh 的 token 交换端点。`POST /api/auth.exchange` 调用配置的 SaaS userinfo 端点，并为请求方浏览器客户端签发 HS256 JWT。

不发布不变式伴生入口，因为交换端点是插件初始化时注册的无状态 HTTP 处理器，没有可断言的持久注册表关系。

## 模型体验

无；本包只在使用 Host API 之前鉴权浏览器。

## 已知限制与延后工作

- **仅 HS256** — 非对称或多 issuer 需后续 provider。
