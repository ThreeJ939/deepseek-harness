# 未合并改动清单

基于 master 提交 `5dda764ed3`（release dsh-0.1.5-alpha.1）的全部工作区改动，共 331 个文件。
整理目的：下次从 master 最新提交拉取后，按此文档逐块将改动移植回来。

---

## 集成顺序（推荐）

下面按依赖拓扑排序，每一层完成后再进行下一层。

1. 根配置
2. 存储后端（storage-pg）
3. Session 持久化（SQLite → PostgreSQL → 通用接口）
4. Host 鉴权层（auth-middleware → auth-login → user-path-policy）
5. API Gateway
6. 核心（session types、workspace registry）
7. Controller 层（session-controller → workspace-controller）
8. Bundle（platform → multi-user）
9. Client 层（connection → file-upload → ui-auth → 其他 UI）
10. 附件层（attachment → attachment-local → attachment-document → attachment-s3）
11. `api/remotes`（最后，依赖以上所有）
12. 文档、Agent Notes、脚本（任意顺序）

---

## 一、根配置

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `tsconfig.base.json` | 新包路径映射 |
| M | `tsconfig.client.json` | 新 client 包加入 |
| M | `tsconfig.host.json` | 新 host 包加入 |
| M | `vitest.config.ts` | 新包测试配置 |
| M | `pnpm-lock.yaml` | 依赖锁定更新 |

---

## 二、存储后端 — PostgreSQL

**新增包** `packages/storage/storage-pg/`（全部 A）：

```
package.json
tsconfig.json
src/index.ts
src/schema.ts
src/unit.ts
tests/pg-backend.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

---

## 三、Session 持久化

### 3a. SQLite（`packages/session/session-persistence-sqlite/`）

**新增包**（全部 A），含完整 SQL 资源文件：

```
package.json / tsconfig.json
src/codec.ts · src/compression.ts · src/index.ts
src/invariant.ts · src/schema.ts · src/sql.ts
src/storage.ts · src/store.ts
tests/built-package.spec.ts
tests/compression-unprofitable.spec.ts
tests/compression.spec.ts
tests/differential.spec.ts
tests/sql-resource-boundary.spec.ts
tests/sqlite.spec.ts
tests/test-sql.ts
tests/resources/sql/（40+ .sql 文件）
resources/sql/（35+ .sql 文件）
README.md / README.zh.md / README.i18n.yaml
```

### 3b. PostgreSQL（`packages/session/session-persistence-pg/`）

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/index.ts · src/invariant.ts · src/schema.ts
src/sql.ts · src/storage.ts · src/store.ts
resources/sql/schema.sql
tests/invariant.spec.ts · tests/pg.spec.ts · tests/schema.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

### 3c. 通用接口

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `packages/session/session-persistence/src/index.ts` | 接口扩展（ownerUserId 过滤等） |

### 3d. 其他 session 相关

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `packages/core/session/src/index.ts` | Session 创建支持 `ownerUserId` |
| M | `packages/core/session/src/types.ts` | `CreateSessionOptions` 新增 `ownerUserId` |
| M | `packages/session-query/session-log-export/src/archive.ts` | 小调整 |
| M | `packages/session/session-format-v0-to-v1/src/payload-validation.ts` | 小调整 |

---

## 四、Host 鉴权层

### 4a. `packages/host/auth-middleware/`

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/index.ts · src/invariant.ts · src/types.ts
tests/auth-middleware.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：JWT 解析、principal 绑定、`getCurrentPrincipal()` 服务暴露。

### 4b. `packages/host/auth-login/`

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/index.ts · src/invariant.ts
tests/auth-login.spec.ts
```

**核心职责**：登录 HTTP endpoint、JWT 签发。

### 4c. `packages/host/webserver/`

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `src/index.ts` | JWT 鉴权路由集成 |
| M | `README.md` · `README.zh.md` | 文档更新 |

### 4d. `packages/sandbox/user-path-policy/`

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/index.ts · src/invariant.ts
tests/user-path-policy.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

---

## 五、API Gateway（`packages/api/gateway/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| A | `src/bind-async-iterable-to-principal.ts` | ALS 绑定 principal，mux 拉取时注入 |
| A | `src/inject-control-viewer-user-id.ts` | mux 注入 `viewerUserId` 至 Control waterfall |
| M | `src/index.ts` | `targetUserId` 过滤逻辑、multi-user mux 处理 |
| M | `src/stream-server.ts` | 流服务端更新 |
| M | `src/types.ts` | `TypertRemoteEventFrame` 携带可选 `targetUserId` |
| M | `src/client/stream-client.ts` | 客户端流更新 |
| M | `tests/gateway.client.spec.ts` | targetUserId 过滤测试 |
| M | `package.json` | 新依赖 |
| M | `tsconfig.host.json` | 新文件引入 |

---

## 六、核心数据模型

### Workspace Registry（`packages/workspace/workspace/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `src/entity.ts` | Workspace entity 支持 `ownerUserId` |
| M | `src/index.ts` | `list(ownerUserId)` 过滤、`archiveSession` |
| M | `src/spec.ts` | zod schema 加入 `ownerUserId` |
| M | `src/types.ts` | 类型扩展 |

---

## 七、Controller 层

### 7a. Session Controller（`packages/api/session-controller/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| **A** | `src/ownership.ts` | **新建**：`getPrincipal` / `ownershipDenied` 工具函数 |
| M | `src/agent.ts` | 创建 Agent 时写 `ownerUserId`；操作前鉴权 |
| M | `src/commands.ts` | Session 命令鉴权 |
| M | `src/control.ts` | Control waterfall 按 `viewerUserId` 过滤 |
| M | `src/list.ts` | `list` 按 `ownerUserId` 过滤 |
| M | `src/index.ts` | 导出更新 |
| M | `src/types.ts` | `SessionSummary` 加入 `ownerUserId` |
| M | `src/client/transport.ts` | 客户端小调整 |
| M | `tests/fake-api.client.ts` | 测试 fixture |
| M | `tests/session-pending-submissions.client.spec.ts` | 测试更新 |
| M | `tests/session-projections.host.spec.ts` | 测试更新 |
| M | `tests/test-remote.ts` | 测试工具 |
| M | `tests/transport.client.spec.ts` | 测试更新 |
| M | `package.json` · `tsconfig.host.json` | 配置更新 |

### 7b. Workspace Controller（`packages/api/workspace-controller/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| **A** | `src/ownership.ts` | **新建**：`getPrincipal` / `sessionOwnerUserId` / `archivedSessionIdsForViewer` / `workspaceOwnershipDenied` |
| **A** | `src/default-workspace-provisioner.ts` | **新建**：follow 时自动创建默认 Workspace |
| M | `src/feed.ts` | **核心改动**：`WorkspaceFeed` 全面 viewer 隔离（见下方说明） |
| M | `src/commands.ts` | `create` 写 `ownerUserId`；`archiveSession` 返回 viewer 过滤集 |
| M | `src/index.ts` | 导出更新 |
| M | `src/types.ts` | `WorkspaceView` 加入 `ownerUserId` |
| M | `tests/workspace-controller.host.spec.ts` | 多 follower viewer 隔离测试（含 archived） |
| M | `package.json` · `tsconfig.host.json` | 配置更新 |
| M | `README.md` · `README.zh.md` · `README.i18n.yaml` | 文档更新 |

#### `src/feed.ts` 改动要点

- `WorkspaceFeed` 构造器：初始化全量 `owners` map（`workspaceId → ownerUserId`）
- `baseline()`：调用 `list(ownerUserId)` + `archivedSessionIdsForViewer(ctx, ownerUserId)`
- `follow()`：从 ALS 捕获 `getPrincipal()?.userId` → `new WorkspaceFollower(viewerUserId)`；调用 `follower.noteArchived()`
- `changed()`：upsert 写 `owners.set`；remove 先取 owner 再清 map，将 owner 传给 `publish()`
- `publish()`：每帧调用 `projectForFollower()`
- `projectForFollower()`：
  - `upsert` → `workspaceVisibleToViewer(ownerUserId, viewerUserId)`
  - `remove` → `workspaceVisibleToViewer(removeOwnerUserId, viewerUserId)`
  - `order` → 投影可见 id 子集，去重跳过不变帧
  - `archived` → **从帧内容过滤**（不读 registry，避免 domain/changed 时 registry 尚未更新），按 `sessionOwnerUserId` 归属；去重跳过不变帧
- `WorkspaceFollower`：新增 `archived` 字段、`noteArchived()`、`archivedUnchanged()`

---

## 八、Bundle 包

### 8a. `packages/bundle/multi-user/`

**新增包**（全部 A）：

```
package.json / tsconfig.json / tsdown.config.ts / cordis.patch.yml
src/index.ts · src/invariant.ts · src/default-workspace.ts
tests/default-workspace.host.spec.ts
README.md / README.zh.md / README.i18n.yaml
MESSAGE-FLOW.md / MESSAGE-FLOW.zh.md / LOCAL-DEV.zh.md
```

**核心职责**：同进程多租户组合，包含 auth-middleware、auth-login、默认 Workspace 自动创建。

### 8b. `packages/bundle/platform/`

**新增包**（全部 A）：

```
package.json / tsconfig.json / tsdown.config.ts / cordis.patch.yml
src/index.ts · src/invariant.ts
tests/platform.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：平台级 Bundle（网络存储后端 PostgreSQL 等）。

### 8c. `packages/bundle/web-app/`

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `cordis.patch.yml` | 引用新 bundle |
| M | `package.json` | 依赖更新 |

---

## 九、Client 层

### 9a. Client Connection（`packages/client/connection/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| **A** | `src/auth-storage-key.ts` | **新建**：JWT token localStorage key 管理 |
| M | `src/rpc-host.ts` | **关键 bug-fix**：JWT principal 存在时 index 放行；multi-user 模式允许登录页 SPA |
| M | `src/client/rpc.ts` | 请求时携带 JWT Authorization 头 |
| M | `src/index.ts` | 导出更新 |
| M | `src/client/fixture.ts` | 测试 fixture |
| M | `tests/node-half.host.spec.ts` | 新测试 |
| M | `tests/fixture.client.spec.ts` | 测试更新 |
| M | `package.json` · `tsconfig.client.json` · `tsconfig.host.json` | 配置更新 |
| M | `README.md` · `README.zh.md` · `README.i18n.yaml` | 文档更新 |

`rpc-host.ts` 改动核心（`authorizeIndex()` 方法中）：

```typescript
// 1. JWT middleware 已绑定 principal → 直接放行
if (this.ctx.get('authMiddleware')?.getCurrentPrincipal() !== undefined) return undefined
// 2. multi-user 模式但尚无 JWT → 允许加载登录页 SPA
if (this.ctx.get('authMiddleware') !== undefined) return true
```

### 9b. File Upload（`packages/client/file-upload/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `src/client/runtime.ts` | 上传请求携带 JWT Authorization 头 |
| M | `src/http-route.ts` | HTTP 路由 JWT 校验 |
| M | `src/index.ts` | 导出更新 |
| M | `tests/file-upload.client.spec.ts` | JWT 鉴权测试 |
| M | `README.md` · `README.zh.md` · `README.i18n.yaml` | 文档更新 |

### 9c. `packages/client/ui-auth/`

**新增包**（全部 A）：

```
package.json / tsconfig.json / tsdown.config.ts
src/config.ts · src/index.ts · src/invariant.ts · src/css-modules.d.ts
src/client/AuthGate.tsx · src/client/AuthGate.module.css
src/client/LoginPage.tsx · src/client/LoginPage.module.css
src/client/auth-session.ts · src/client/index.ts · src/client/locales.ts
tests/auth-gate.client.spec.tsx
```

**核心职责**：登录页 UI 组件（LoginPage）+ 鉴权守卫（AuthGate）。

### 9d. 其他 Client UI

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `packages/client/ui-conversation/src/client/contract/input.ts` | 附件输入支持 |
| M | `packages/client/ui-conversation/src/client/locales.ts` | 附件相关 locale 字符串 |
| M | `packages/client/ui-conversation/src/client/service.ts` | 附件处理逻辑 |
| M | `packages/client/ui-conversation/tests/image-labels.client.spec.ts` | 测试更新 |
| M | `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` | 测试更新 |
| M | `packages/client/ui-layout/src/client/AppFrame.tsx` | 集成 `AuthGate` |
| M | `packages/client/ui-layout/src/client/index.ts` | 导出更新 |
| M | `packages/client/ui-primitives/src/Modal.tsx` | 小调整 |
| M | `packages/client/ui-primitives/tests/atoms.client.spec.tsx` | 测试更新 |

---

## 十、附件层

### 10a. Attachment 通用接口（`packages/attachment/attachment/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `src/error.ts` | 新增错误类型 |
| M | `src/types.ts` | 新增文档/BMP 附件类型 |
| M | `README.md` · `README.zh.md` · `README.i18n.yaml` | 文档更新 |

### 10b. Local 实现（`packages/attachment/attachment-local/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `src/file-store.ts` | 文件存储支持新附件类型 |
| M | `src/image.ts` | BMP 图片支持 |
| M | `src/index.ts` | 导出更新 |
| M | `src/normalization.ts` | 归一化逻辑扩展 |
| M | `tests/index.spec.ts` · `tests/store.spec.ts` | 测试更新 |

### 10c. `packages/attachment/attachment-document/`

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/extractor.ts · src/index.ts
tests/extractor.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：文档附件内容提取（PDF、Word、Markdown 等）。

### 10d. `packages/attachment/attachment-s3/`

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/index.ts · src/compression-limiter.ts
tests/s3.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：S3 附件存储后端。

---

## 十一、Remote 事件（`packages/api/remotes/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `src/index.ts` | **关键 bug-fix**：`sessionOwners` map + `extractTargetUserId` + `goal/activation-changed` 打标 |
| M | `tests/remote-events.host.spec.ts` | targetUserId 测试 + goal 打标 + 已删 session 后无 target |
| M | `README.md` · `README.zh.md` · `README.i18n.yaml` | 文档更新 |

`src/index.ts` 改动核心：

```typescript
// 每个 Client stream 独立维护 sessionId → ownerUserId map
const sessionOwners = new Map<string, string>()

// api-session/added 时入库
// api-session/removed 先取 target 再删 map
// frame 携带 targetUserId（owner-scoped 事件）

// extractTargetUserId() switch 覆盖：
// · api-session/added         → payload.ownerUserId
// · api-session/removed/status/activity/error
//   + agent-preset/selected   → sessionOwners / live registry
// · goal/activation-changed   → payload.sessionId → sessionOwners / live registry
// · 其余（settings, commands…）→ undefined（广播）
```

---

## 十二、其他 packages

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `packages/credentials/credentials-local/src/index.ts` | 小调整 |
| M | `packages/extensions/tool-cordis/src/api-catalog.ts` | 目录更新 |
| M | `packages/fs/tool-fs/src/read-image.ts` | BMP 读取支持 |
| M | `packages/fs/tool-fs/tests/read-image.spec.ts` | BMP 测试 |
| M | `packages/llm/llm/src/content.ts` | BMP content 类型 |
| M | `packages/llm/llm/tests/content.spec.ts` | 测试更新 |
| M | `packages/llm/llm-deepseek/src/adapter.ts` | BMP + 附件适配 |
| M | `packages/llm/llm-deepseek/src/file-store.ts` | 附件存储 |
| M | `packages/llm/llm-deepseek/tests/file-store.spec.ts` | 测试更新 |
| M | `packages/llm/llm-deepseek/tests/serialize.spec.ts` | 测试更新 |
| M | `packages/settings/settings-file/src/index.ts` | 多用户设置文件路径 |
| M | `packages/settings/settings-file/package.json` · `tsconfig.json` | 配置更新 |

---

## 十三、脚本（开发辅助）

| 状态 | 文件 | 说明 |
|------|------|------|
| A | `scripts/mint-multi-user-jwt.mjs` | 本地生成多用户 JWT token |
| A | `scripts/smoke-multi-user-api.mjs` | 多用户 API smoke 测试 |

---

## 十四、Agent Notes（全部新增 A）

每条均含 `.md` / `.zh.md` / `.i18n.yaml` 三件套，位于 `.agents/notes/implemented/`。

| 类别 | slug |
|------|------|
| architecture | `2026-08-27-same-process-multi-tenant` |
| architecture | `2026-09-03-sqlite-handle-session-persistence` |
| architecture | `2026-09-08-platform-network-storage-backends` |
| bug-fix | `2026-09-04-mux-stream-als-rebind` |
| bug-fix | `2026-09-10-file-upload-jwt-auth` |
| bug-fix | `2026-09-10-multi-user-spa-index-auth` |
| bug-fix | `2026-09-10-remote-event-target-user-id` |
| bug-fix | `2026-09-11-workspace-follow-viewer-filter` |
| feature | `2026-09-03-multi-user-default-workspace-provision` |
| feature | `2026-09-09-document-attachments-and-bmp` |
| feature | `2026-09-10-image-bmp-admission` |

---

## 十五、文档

| 状态 | 文件 | 说明 |
|------|------|------|
| A | `docs/platform-architecture.zh.md` | 平台架构文档（中文） |
| M | `docs/subsystems/attachment.md` · `.zh.md` · `.i18n.yaml` | 附件子系统文档更新 |

---

## 注意事项

1. **`archived` 增量过滤设计**：`projectForFollower` 中过滤 `archived` 帧时直接从**帧内容**（`frame.archivedSessionIds`）过滤，而不是重读 `ctx.workspaceRegistry.archivedSessionIds`——因为 `domain/changed` 回调触发时 registry 的归档列表可能尚未更新（写操作是异步的）。baseline 和 `archiveSession` 命令响应时 registry 已是最新，使用 `archivedSessionIdsForViewer(ctx, viewerUserId)` 读 registry。

2. **`goal/activation-changed` 打标**：依赖 `sessionOwners` map，只有 `api-session/added` 之后才能解析。若 Session 在 source 启动前已存在，fallback 到 live `ctx.get('sessions')` registry 的 header。

3. **全局广播事件（有意保留）**：`settings/document-updated`、`commands/change`、`cordis/*`、`llm/adapters-updated` 仍广播给所有连接，不做 per-user 过滤。

4. **`pnpm-lock.yaml` 冲突**：如果 master 也有 pnpm-lock 更新，建议 `pnpm install` 重新生成而不是手动合并。
