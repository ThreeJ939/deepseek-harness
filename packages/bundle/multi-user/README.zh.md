# @deepseek-ai/dsh-multi-user

English | [中文](README.md)

同进程多租户 profile bundle。[`cordis.patch.yml`](cordis.patch.yml) 挂载 JWT 鉴权（[`dsh-host-auth-middleware`](../../host/auth-middleware/README.zh.md)）、切换会话持久化为 SQLite（[`dsh-session-persistence-sqlite`](../../session/session-persistence-sqlite/README.zh.md)）、禁用 JSONL、启用凭据 `readOnly`、设置 `userOverlay`、每用户工作区路径边界（[`dsh-user-path-policy`](../../sandbox/user-path-policy/README.zh.md)），以及默认工作区 provisioner：在已鉴权用户尚无 Workspace 时，于首次 `workspace.follow` 登记 `$DSH_HOME/workspaces/<userId>/default`。

在 base/web 组合上用 `dsh --profile multi-user`（或等价 patch 层）启用。启动前设置至少 32 字符的 `DSH_JWT_SECRET`。

本地 PowerShell 启动与签发 JWT：[LOCAL-DEV.zh.md](LOCAL-DEV.zh.md)。

设计记录：[同进程多租户 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-27-same-process-multi-tenant.zh.md)。默认工作区 provision：[默认工作区 provision Agent Note](../../../.agents/notes/implemented/feature/2026-09-03-multi-user-default-workspace-provision.zh.md)。消息发送与处理全流程：[MESSAGE-FLOW.md](MESSAGE-FLOW.md)。

## 模型体验

bundle 本身无模型面；所挂插件保留各自的模型可见表面。

## 已知限制与延后工作

- **SQLite schema 18 硬切** — schema 17 会话库不兼容；需重建而非迁移。
- **部署级凭据** — 启用本 bundle 后用户不能经网关写入 API key。
