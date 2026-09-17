# Agent Note: 面向 Web 白标的智枢品牌包

Status: implemented

[English](2026-09-15-zhishu-client-brand-package.md) | 中文

## 问题

白标部署需要不同于 DeepSeek Harness 的产品标志与名称。就地改动 `FishLogo`、`ui-brand-official` 或会话首屏回退，会把分叉身份绑到上游呈现上，并破坏文档已写明的替换路径。

## 决策

交付私有包 `@deepseek-ai/dsh-client-ui-brand-zhishu`：挂载即占据 `sidebar.brand.mark`、`sidebar.brand.name` 与 `conversation.hero.brand.mark`。标志是来自 `apps/web/public/` 的静态 `/zhishu-icon.svg` 图片；名称读取 `DSH_CLIENT_TITLE`，缺省为智枢2.0。`web-app` bundle 挂载本包，而不再挂载 `dsh-client-ui-brand-official`。浏览器标题、favicon 与 PWA manifest 仍属构建/表面职责，不在 slot 系统之内。多用户登录门 `dsh-client-ui-auth` 使用同一 public 标志与智枢2.0 locale 标题，因为该表面硬编码 hero，而不是品牌 slot。

## 考虑过的替代方案

**就地打补丁改官方品牌原语**会使所有消费这些包的方都变成白标，并与上游合并冲突。已拒绝；官方包 README 已要求用替换 occupant 包。

**用 `DSH_CLIENT_BUILD_PROFILE=official` 做 profile 门控**与 DeepSeek 包一致，但会在 local 构建下隐藏智枢身份。已拒绝：本部署唯一上线的 Web 身份就是智枢2.0。

**在 `web-app` 内联品牌 JSX**会绕过 slot 组合模型，并重复声明感知注册。已拒绝。

## 后果

仓库中仍保留 `ui-brand-official`，供仍挂载它的上游/测试组装使用。slot-catalog 生成可能把两个包都列为 occupant。桌面端 `productName` 以及仍写 DeepSeek Harness 的欢迎 / DeepSeek API Key 引导文案不在本次变更范围内。

## 必要验证

- 包单元测试覆盖注册、拆除与标志/名称渲染。
- `web-app` 的 cordis patch 与依赖切换到智枢包。
- 既有标题 / favicon / manifest 表面检查仍与智枢2.0 对齐。
- `ui-auth` 登录门展示智枢标志与产品标题。
