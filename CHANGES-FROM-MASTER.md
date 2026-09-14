# 未合并改动清单

基于 master 提交 `c291e7961a`（Merge PR #3977 / release sync，当前等同 `0.1.5-rc.2` 线）的工作区改动，共 **375** 个路径（A 262 / M 112 / AM 1）。
整理目的：下次从 master 最新提交拉取后，按此文档逐块将改动移植回来。

分支：`0.1.5-rc.2_multi-user`（HEAD 与 master 相同，全部改动仍在 index/worktree，尚未落成独立 commit）。

主题：同进程多用户、Session 持久化（SQLite / PostgreSQL）、S3 附件、文档与 BMP 上传、JWT 鉴权与 SPA 登录。

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
8. Bundle（platform → multi-user → web-app）
9. Client 层（connection → file-upload → ui-auth → 其他 UI）
10. 附件层（attachment → attachment-local → attachment-document → attachment-s3）
11. `api/remotes`（最后，依赖以上所有）
12. LLM / FS / settings 等配套
13. 文档、Agent Notes、脚本（任意顺序）

提交前先从暂存区去掉误加的构建产物（见文末「注意事项」）。

---

## 一、根配置

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `tsconfig.base.json` | 新包路径映射 |
| M | `tsconfig.client.json` | 新 client 包加入 |
| M | `tsconfig.host.json` | 新 host 包加入 |
| M | `vitest.config.ts` | 新包测试配置 |
| M | `pnpm-lock.yaml` | 依赖锁定更新 |
| M | `THIRD_PARTY_NOTICES.md` | pre-commit 再生的第三方声明 |

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
src/codec.ts · compression.ts · index.ts · schema.ts · sql.ts · storage.ts · store.ts
resources/sql/（35 .sql：begin*、commit、rollback、journal-mode-*、schema、select-*、insert-*、upsert-*、update-*、set-*、mmap-off、foreign-keys-on、synchronous-full、trusted-schema-off …）
tests/built-package.spec.ts
tests/compression-unprofitable.spec.ts · compression.spec.ts
tests/differential.spec.ts · sql-resource-boundary.spec.ts · sqlite.spec.ts · test-sql.ts
tests/resources/sql/（23 .sql fixtures）
README.md / README.zh.md / README.i18n.yaml
```

### 3b. PostgreSQL（`packages/session/session-persistence-pg/`）

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/index.ts · schema.ts · sql.ts · storage.ts · store.ts
resources/sql/schema.sql
tests/pg.spec.ts · schema.spec.ts
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

**新增包**（源码 A；勿提交 `src/*.js` / `*.map`，见注意事项）：

```
package.json / tsconfig.json
src/index.ts · types.ts
tests/auth-middleware.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：JWT 解析、principal 绑定、`getCurrentPrincipal()` 服务暴露。

### 4b. `packages/host/auth-login/`

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/index.ts
tests/auth-login.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：`POST /api/auth.exchange`、调用 SaaS userinfo、签发 HS256 JWT。

### 4c. `packages/host/webserver/`

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `src/index.ts` | JWT 鉴权 / login 路由集成 |

（同样勿提交误 staged 的 `src/*.js` / `*.map`。）

### 4d. `packages/sandbox/user-path-policy/`

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/index.ts
tests/user-path-policy.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：多租户 `tools/pre-execute` 路径必须落在 `$DSH_HOME/workspaces/<ownerUserId>/`。

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
| M | `tests/*` | fake-api、transport、session-* 等测试更新 |
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
| M | `tests/transport.client.spec.ts` | 测试更新 |
| M | `package.json` · `tsconfig.host.json` | 配置更新 |

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

**新增包**（全部 A；`LOCAL-DEV.zh.md` 为 **AM**：已暂存后又有工作区修改）：

```
package.json / tsconfig.json / tsdown.config.ts / cordis.patch.yml
src/index.ts · src/default-workspace.ts
tests/default-workspace.host.spec.ts
README.md / README.zh.md / README.i18n.yaml
MESSAGE-FLOW.md / MESSAGE-FLOW.zh.md / LOCAL-DEV.zh.md
```

**核心职责**：同进程多租户组合（JWT 鉴权、SQLite 会话持久化切换、凭据 readOnly、`userOverlay`、每用户路径策略、默认 Workspace provisioner）。

本地启动：见 `LOCAL-DEV.zh.md`；组合示例：

```powershell
pnpm dsh --profile web `
  --patch packages/bundle/multi-user/cordis.patch.yml `
  --patch packages/bundle/platform/cordis.patch.yml
```

（每个 `--patch` 单独传一次；不要把两个 yml 写成一个参数的两个位置参数。）

### 8b. `packages/bundle/platform/`

**新增包**（全部 A）：

```
package.json / tsconfig.json / tsdown.config.ts / cordis.patch.yml
src/index.ts
tests/platform.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：平台覆盖层——禁用本地 SQLite/本地附件/JSON storage，挂载 `session-persistence-pg`、`attachment-s3`、`storage-pg`。

必需环境变量：`DATABASE_URL`、`S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`；另需 `DSH_JWT_SECRET`（≥32 字符）等 multi-user 项。

### 8c. `packages/bundle/web-app/`

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `cordis.patch.yml` | 引用新 bundle / UI 插件 |
| M | `package.json` | 依赖更新 |

---

## 九、Client 层

### 9a. Client Connection（`packages/client/connection/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| **A** | `src/auth-storage-key.ts` | **新建**：JWT token localStorage key 管理 |
| M | `src/rpc-host.ts` | **关键 bug-fix**：JWT principal 存在时 index 放行；multi-user 模式允许登录页 SPA |
| M | `src/client/rpc.ts` | 请求时携带 JWT Authorization 头 |
| M | `src/client/fixture.ts` | 测试 fixture |
| M | `package.json` · `tsconfig.client.json` · `tsconfig.host.json` | 配置更新 |

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

### 9c. `packages/client/ui-auth/`

**新增包**（全部 A）：

```
package.json / tsconfig.json / tsdown.config.ts
src/config.ts · src/index.ts · src/css-modules.d.ts
src/client/AuthGate.tsx · AuthGate.module.css
src/client/LoginPage.tsx · LoginPage.module.css
src/client/auth-session.ts · index.ts · locales.ts
tests/auth-gate.client.spec.tsx
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：登录页 UI（LoginPage）+ 鉴权守卫（AuthGate）。

### 9d. `packages/client/ui-sidebar-textpreview/`

**新增包**（全部 A）：

```
package.json / tsconfig.json / tsdown.config.ts
src/index.ts · css-modules.d.ts
src/client/TextPreview.tsx · TextPreview.module.css
src/client/definition.ts · face.ts · failure-line.ts · icons.tsx
src/client/index.ts · locales.ts · rpc.ts · store.ts
tests/（apply · definition · face · failure-line · fixtures · lines · rpc · store · text-preview）
README.md / README.zh.md / README.i18n.yaml
```

**注意**：与 document preview 在 Sidebar tab kind `text` / `fallback` 档互斥；已发布 web-app 挂载 documentpreview，勿同组合双挂。

### 9e. 其他 Client UI

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `packages/client/ui-conversation/src/client/contract/input.ts` | 附件输入支持 |
| M | `packages/client/ui-conversation/src/client/locales.ts` | 附件相关 locale |
| M | `packages/client/ui-conversation/src/client/service.ts` | 附件处理逻辑 |
| M | `packages/client/ui-layout/src/client/AppFrame.tsx` | 集成 `AuthGate` |
| M | `packages/client/ui-layout/src/client/index.ts` | 导出更新 |
| M | `packages/client/ui-primitives/src/Modal.tsx` | 小调整 |

---

## 十、附件层

### 10a. Attachment 通用接口（`packages/attachment/attachment/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `src/error.ts` | 新增错误类型 |
| M | `src/types.ts` | 新增文档/BMP 附件类型 |

### 10b. Local 实现（`packages/attachment/attachment-local/`）

| 状态 | 文件 | 说明 |
|------|------|------|
| M | `src/file-store.ts` | 文件存储支持新附件类型 |
| M | `src/image.ts` | BMP 图片支持 |
| M | `src/index.ts` | 导出更新 |
| M | `src/normalization.ts` | 归一化逻辑扩展 |
| M | `src/request-image.ts` | request-image 路径 |
| M | `tests/index.spec.ts` · `request-image.spec.ts` · `store.spec.ts` | 测试更新 |

### 10c. `packages/attachment/attachment-document/`

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/extractor.ts · index.ts
tests/extractor.spec.ts
README.md / README.zh.md / README.i18n.yaml
```

**核心职责**：文档附件内容提取（PDF、DOCX、Markdown 等）。

### 10d. `packages/attachment/attachment-s3/`

**新增包**（全部 A）：

```
package.json / tsconfig.json
src/index.ts · compression-limiter.ts
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
| M | `package.json` · `tsconfig.client.json` | 配置更新 |

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
| M | `packages/fs/tool-fs/src/read.ts` · `write.ts` · `edit.ts` | FS 工具小调整 |
| M | `packages/fs/tool-fs/package.json` | 依赖 |
| M | `packages/fs/tool-fs/tests/read-image.spec.ts` · `tools.spec.ts` | 测试 |
| M | `packages/llm/llm/src/content.ts` | BMP content 类型 |
| M | `packages/llm/llm/tests/content.spec.ts` | 测试更新 |
| M | `packages/llm/llm-deepseek/src/adapter.ts` | BMP + 附件适配 |
| M | `packages/llm/llm-deepseek/src/file-store.ts` | 附件存储 |
| M | `packages/llm/llm-deepseek/src/image-tokens.ts` · `request-pricing.ts` · `index.ts` | 计价/导出 |
| M | `packages/llm/llm-deepseek/package.json` | 依赖 |
| M | `packages/llm/llm-deepseek/tests/*` | adapter / file-store / image-tokens / pricing / serialize / e2e |
| M | `packages/settings/settings-file/src/index.ts` | 多用户设置文件路径 |
| M | `packages/settings/settings-file/package.json` · `tsconfig.json` | 配置更新 |
| M | `packages/test-support/remote-mock/tests/proxy.client.spec.ts` | 测试更新 |

---

## 十三、脚本（开发辅助）

| 状态 | 文件 | 说明 |
|------|------|------|
| A | `scripts/mint-multi-user-jwt.mjs` | 本地生成多用户 JWT token |
| A | `scripts/smoke-multi-user-api.mjs` | 多用户 API smoke 测试 |
| M | `scripts/check-workspace-constraints.ts` | workspace 约束门禁更新 |

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
| process | `2026-09-08-comment-only-review-routing` |
| process | `2026-09-08-trusted-changed-file-review-routing` |

---

## 十五、文档

| 状态 | 文件 | 说明 |
|------|------|------|
| A | `docs/platform-architecture.zh.md` | 平台架构文档（中文） |
| M | `docs/subsystems/attachment.md` · `.zh.md` · `.i18n.yaml` | 附件子系统文档更新 |

---

## 注意事项

1. **提交前去掉误加构建产物**（当前 staged，不应进仓）：
   - `packages/host/auth-middleware/src/*.{js,js.map,d.ts.map}`
   - `packages/host/webserver/src/*.{js,js.map,d.ts.map}`
   ```powershell
   git restore --staged packages/host/auth-middleware/src/*.js packages/host/auth-middleware/src/*.map packages/host/webserver/src/*.js packages/host/webserver/src/*.map
   # 若工作区也不需要，可再 delete / git clean
   ```

2. **`LOCAL-DEV.zh.md` 为 AM**：暂存后再改过；提交前再 `git add packages/bundle/multi-user/LOCAL-DEV.zh.md`。

3. **双语配对**：改 README / Agent Note 任一侧后必须同步对侧并用 `pnpm run verify-translation-pairing --write <pair>` 重录；pre-commit 会 `--cached` 检查。

4. **`archived` 增量过滤设计**：`projectForFollower` 中过滤 `archived` 帧时直接从**帧内容**（`frame.archivedSessionIds`）过滤，而不是重读 `ctx.workspaceRegistry.archivedSessionIds`——因为 `domain/changed` 回调触发时 registry 的归档列表可能尚未更新。baseline 和 `archiveSession` 命令响应时 registry 已是最新，使用 `archivedSessionIdsForViewer(ctx, viewerUserId)` 读 registry。

5. **`goal/activation-changed` 打标**：依赖 `sessionOwners` map，只有 `api-session/added` 之后才能解析。若 Session 在 source 启动前已存在，fallback 到 live `ctx.get('sessions')` registry 的 header。

6. **全局广播事件（有意保留）**：`settings/document-updated`、`commands/change`、`cordis/*`、`llm/adapters-updated` 仍广播给所有连接，不做 per-user 过滤。

7. **`pnpm-lock.yaml` 冲突**：如果 master 也有 pnpm-lock 更新，建议 `pnpm install` 重新生成而不是手动合并。

8. **pre-commit**：大 diff 会跑 oxlint（staged）、`gen-third-party-notices`、translation pairing；失败时先看 `🥊 translation pairing`，不要误以为卡住。
