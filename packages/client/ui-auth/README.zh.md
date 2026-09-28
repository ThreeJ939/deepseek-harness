# @deepseek-ai/dsh-client-ui-auth

[English](README.md) | 中文

多用户登录 UI 插件。Host 半侧把 OAuth 与 JWT 粘贴选项写入 index HTML；浏览器半侧在布局根上注册强制模态门。

不发布不变式伴生入口，因为本插件只持有一个由 effect disposer 释放的槽位注册；运行时不存在第二个可核验权威。

## 模型体验

无；本包只在进入聊天前拦截浏览器访问。

## 已知限制与延后工作

- **JWT 粘贴面向测试** — 生产部署在配置了端点时应依赖 OAuth PKCE。
