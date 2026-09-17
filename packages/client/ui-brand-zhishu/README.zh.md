---
description: "面向 Web 客户端侧栏与首屏的智枢2.0 品牌填充；供替换官方品牌包的部署阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-zhishu

[English](README.md) | 中文

## 概述

本私有包用智枢2.0 身份填充侧栏品牌 slot 与会话首屏标志。部署身份不是 DeepSeek Harness 时，用本包替换 `@deepseek-ai/dsh-client-ui-brand-official`。插件挂载即注册——不受 `DSH_CLIENT_BUILD_PROFILE` 门控。本包不保留运行时状态，也不影响模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在浏览器插件名单中用本包替换官方品牌行，由 web 应用的 public 资源提供 `/zhishu-icon.svg`，并将 `DSH_CLIENT_TITLE`（以及对应的 favicon / PWA manifest）设为同一产品名。

### 替换官方品牌

占据 `sidebar.brand.mark`、`sidebar.brand.name` 与 `conversation.hero.brand.mark` 是唯一的组合路径。同一名单中不要再挂载 `dsh-client-ui-brand-official`，以免两组品牌填充互相竞争。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

三个填充作为一组声明感知的注册安装：嵌套的 `ctx.slots.inject()` 调用等待各声明，因此无论本行在声明者之前还是之后激活，这组注册都能工作；声明消失时全部填充一并撤回，HMR 期间也不会留下残缺的品牌混合。标志是指向 `/zhishu-icon.svg` 的静态 `<img>`；名称读取 `DSH_CLIENT_TITLE`，缺省为智枢2.0。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)；node 半部是一个空 Loader 座位。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当品牌面不够用时阅读以下页面。它们从本包占据的 slot 进入渲染这些 slot 的外壳。

- [ui-sidebar](../ui-sidebar/README.zh.md)——声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md)——在首屏声明 `conversation.hero.brand.mark`。
- [ui-brand-official](../ui-brand-official/README.zh.md)——本包所替换的 DeepSeek Harness 填充。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册 slot。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了品牌呈现的供给方式。它们是当前包约束，不是品牌设计对比或任务积压。

- **只有一组填充**——替代呈现属于占据相同 slot 的另一个 Cordis 包。
- **浏览器标题独立**——`DSH_CLIENT_TITLE` 在构建时选择标题文本，而非通过 UI slot。
- **标志字节属于 web 应用资源**——本包引用 `/zhishu-icon.svg`；文件本身位于 `apps/web/public/`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包不保留可变状态，三个 slot occupant 通过同一个事务性 effect 安装和释放。
