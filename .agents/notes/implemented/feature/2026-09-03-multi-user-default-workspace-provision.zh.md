# Agent Note: 多用户默认工作区 provision

Status: implemented

[English](2026-09-03-multi-user-default-workspace-provision.md) | 中文

## 问题

部门多用户 Web 部署（[同进程多租户](../architecture/2026-08-27-same-process-multi-tenant.zh.md)）要求每个 Session 挂在 Workspace 下才能打开输入框，但产品仍要求用户浏览宿主文件系统并手动创建 Workspace。远程用户无法在共享服务器上有意义地挑选项目目录，空的 Workspace 列表会在登录后卡住 UI。

## 决策

当组合挂载 `dsh-multi-user` bundle 时，Host 为每个已鉴权用户自动 provision 一条默认 Workspace：

1. **路径。** `$DSH_HOME/workspaces/<userId>/default/`（`mkdir` recursive）。该路径落在 [`dsh-user-path-policy`](../../../../packages/sandbox/user-path-policy/README.zh.md) 已约束工具绝对路径的同一根下。
2. **触发。** `workspace.follow` 在发出 baseline 之前调用可选的 `ctx.defaultWorkspaceProvisioner.provision()` 钩子，从而在用户尚无 Workspace 时让首帧已包含新行。仅靠插件 `apply` 读不到 JWT 主体（ALS 是请求作用域）。
3. **幂等。** 无主体时 no-op；`workspaceRegistry.list(userId)` 非空时 no-op；竞态时依赖按路径唯一的 `workspaceRegistry.create`。
4. **失败。** follow 入口吞掉 provision 错误，空 baseline 仍可推送；相对列表而言自动创建是尽力而为。
5. **UI。** 现有 `ui-workspace` 导航在列表非空时会连接最近 Workspace，登录到可聊无需改 Client。

钩子接口落在 `@deepseek-ai/dsh-api-workspace-controller`（`DefaultWorkspaceProvisioner`）；实现是 `@deepseek-ai/dsh-multi-user` 的 Cordis 入口。单用户组合不提供该服务，仍用手选目录。

## 后果

- 已鉴权多用户登录可在不浏览宿主磁盘的情况下进入可用 Session。
- 显示标题默认为 basename `default`（create 未传显式 title）。
- 仍可通过 directory-picker 在用户根下添加更多项目。
- 不提供强沙箱隔离；只确立每用户工作目录约定。

## 备选方案

- **Client 侧在列表为空时 create** — Host 改动更少，但依赖 UI 启动顺序，并在多个 Client 间重复 provision。
- **以 `$DSH_HOME/workspaces/<userId>/` 作为 Workspace 路径** — 把用户根与项目目录叠在一起，path-policy 根下无法再放并列项目目录。
- **进程启动时为每个已知用户 provision** — 启动时无主体；需要 Host 并不拥有的用户目录。
