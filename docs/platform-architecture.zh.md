# DeepSeek Harness 平台化四层架构

> 本文描述将单机 DSH Host 演进为可水平扩展的平台架构的设计方案。四层是**职责划分**，不是强制的部署粒度——可以分期演进，不必一步到位。

---

## 目录

- [背景与现状](#背景与现状)
- [架构总览](#架构总览)
- [第一层：API / BFF（无状态控制入口）](#第一层apibff无状态控制入口)
- [第二层：队列与调度（串行化与租约）](#第二层队列与调度串行化与租约)
- [第三层：Worker 池（有状态执行面）](#第三层worker-池有状态执行面)
- [第四层：集中式存储（数据权威真源）](#第四层集中式存储数据权威真源)
- [跨层消息流：一条用户消息的完整路径](#跨层消息流一条用户消息的完整路径)
- [与今天 DSH 单机的对应关系](#与今天-dsh-单机的对应关系)
- [分期演进路径](#分期演进路径)
- [服务打包建议](#服务打包建议)
- [关键设计原则](#关键设计原则)

---

## 背景与现状

### 今天是什么架构

当前 `dsh-multi-user` 是**同进程多租户单 Host**：

```
┌─────────────────────────────────────────────────────────────┐
│  一个 Node Host 进程（Cordis 组合）                           │
│                                                             │
│  HTTP /api + WS /api/remote.mux                             │
│       ↓                                                     │
│  session-controller / workspace-controller / gateway        │
│       ↓                                                     │
│  ctx.agents + agent-loop（内存 Inbox + 驱动 turn）            │
│       ↓                                                     │
│  ctx.sessions（内存日志）←→ SessionHandle → sessions.db      │
│       ↓                                                     │
│  session/event 进程内广播 → follow / control 推给浏览器        │
│                                                             │
│  同机：$DSH_HOME（storages / attachments / workspaces）       │
└─────────────────────────────────────────────────────────────┘
```

### 与高可用冲突的地方

| 组件 | 现状 | 对高可用的影响 |
|------|------|----------------|
| Agent Inbox / loop | **进程内内存** | 实例挂了，进行中的 turn 断；另一台无法接管 |
| `session.follow` WS | 绑在**单连接、单 Host** | 不能多机订阅同一会话 |
| 会话日志 | **单文件 SQLite** | 多实例同时写不安全 |
| Workspace / storages | **本地 JSON 目录** | 多机需共享 |
| 工作区文件 / 附件 | **`$DSH_HOME` 本地盘** | 工具读写路径绑死本机 |
| Jobs / control | **进程本地** | 重启后 jobs 丢失 |

---

## 架构总览

```
                 无状态可水平扩展
┌──────────────────────────────────────┐
│  第一层：API / BFF（多副本）            │
│  - 鉴权、RBAC、限流                    │
│  - prompt / create / cancel 入队      │
│  - follow：订阅存储读游标，不跑 loop    │
└────────────┬─────────────────────────┘
             │ 命令 / 租约查询 / 事件订阅
             ▼
┌──────────────────────────────────────┐
│  第二层：队列 + 调度                   │
│  - 按 sessionId 串行化命令             │
│  - 租约：同一时刻至多一个 Worker 持有写权│
│  - 调度：有积压则分配 Worker            │
└────────────┬─────────────────────────┘
             │ 领取 session 任务 / 续租
             ▼
┌──────────────────────────────────────┐
│  第三层：Worker 池（有状态，可多机）     │
│  - 仍跑完整的 Cordis agent-loop        │
│  - 持有 SessionHandle(write) + Inbox  │
│  - 调 LLM、跑工具、append 日志          │
└────────────┬─────────────────────────┘
             │ append / flush / GetObject
             ▼
┌──────────────────────────────────────┐
│  第四层：集中式存储 + 对象存储           │
│  - 事件日志（可多读者）                  │
│  - 附件 / 工作区文件                    │
│  - workspace / settings 元数据         │
└──────────────────────────────────────┘
```

**核心原则：**
- **写执行权跟租约走**：只有持租约的 Worker 才能写日志、跑 loop。
- **读跟已提交存储走**：API/follow 直接读存储，不依赖 loop 同机。
- **API 不跑 loop**：无 `ctx.agents`、无 write handle、无 LLM 调用。

---

## 第一层：API / BFF（无状态控制入口）

### 职责

| 职责 | 描述 |
|------|------|
| **鉴权** | 校验 JWT，解析 `userId`；不持久化 Agent 状态 |
| **所有权校验** | 确认操作方是会话/工作区的合法 `ownerUserId` |
| **限流 / RBAC** | 配额、权限、速率控制 |
| **写命令入口** | `prompt` / `create` / `steer` / `cancel` → **入队**，不在本机 `followup()` |
| **读订阅入口** | `follow` / 列表 / 历史分页 → **读存储或订阅事件流** |
| **协议适配** | 对外维持 Typert Remote 协议或 SaaS 自定义 REST/SSE |

### 典型请求处理

**`session.prompt`（写入路径）**

```
接收请求 + JWT 校验
  → 解析 ownerUserId
  → 校验 sessionId 归属
  → 校验 content / 附件策略
  → Enqueue({ sessionId, type:'prompt', requestId, content, mode })
  → 返回 { accepted: true }    ← 表示「已进权威队列」
```

**`session.follow`（订阅路径）**

```
接收请求 + JWT 校验
  → 从集中存储读 snapshot（header + 历史到某 seq）
  → 订阅 sessionId 的「新 seq」通知（总线 / CDC / 轮询 revision）
  → 把 append 帧逐条推给浏览器 WS
```

### 关键特性

- **无 Agent 实例**：不 `resolveAgent`，不持 write handle。
- **副本可随时增减**：任意副本接 HTTP/WS，挂了不影响正在跑的 loop。
- **与浏览器的 echo 对齐**：客户端 submission echo 的退休条件改为「存储里出现带该 `rpcId` 的 `user/message`」。

### 与今天 DSH 的差别

| 今天 | 平台化 API 层 |
|------|--------------|
| `session-controller.prompt` → 本机 `resolveAgent` → Inbox | 只入队 |
| `follow` 订本进程 `session/event` | 订存储/总线读游标 |
| Connection/Gateway 与 Host loop 同进程 | Gateway 壳保留，背后改为 BFF 逻辑 |

---

## 第二层：队列与调度（串行化与租约）

### 职责

| 子能力 | 描述 |
|--------|------|
| **命令队列** | 按 `sessionId` 分区存储 prompt/steer/cancel；同会话 FIFO |
| **调度** | 有积压且无持有者 → 选 Worker 竞争租约；已有持有者 → 通知/投递 |
| **租约管理** | `sessionId → { workerId, epoch, expiresAt }`；保证单写者 |
| **负载均衡** | 按 Worker 活跃会话数选人；支持排水、强制 steal |

### 「按 sessionId 串行化」示意

```
Session S1 队列:  [P1] → [P2] → [cancel] → [P3]   ← 严格顺序，单消费者
Session S2 队列:  [P4] → [P5]                      ← 另一分区，可并行
Session S3 队列:  [P6]
```

**并行度来自不同会话，不是同一会话多 Worker。**

### 租约生命周期

```
Worker 竞争租约:
  AcquireLease(sessionId)
    → 成功: epoch++，允许 open(id, 'write')
    → 失败: 等下次调度

Worker 运行中:
  Heartbeat(sessionId, workerId, epoch)  ← 周期续租，防 TTL 过期

Worker 正常结束:
  ReleaseLease(sessionId)  或  保持热租约

Worker 宕机:
  停止 Heartbeat → TTL 到期
    → 新 Worker 竞争租约，带新 epoch
    → 旧 epoch 的写操作被存储层拒绝（fencing token）
```

### 租约保证什么

| 保证 | 含义 |
|------|------|
| **互斥** | 同一会话只有租约持有者能 open(write) 和消费命令 |
| **可交接** | 宕机后 TTL 到期，新 Worker 可接管 |
| **防脑裂** | `epoch` 作 fencing token，旧写者回来也被拒绝 |
| **串行** | 命令按 sessionId 分区，持有者顺序处理 |

### 与今天 DSH 的对应

| 今天（单机） | 平台化 |
|------------|--------|
| `Inbox` 内存 + `wakeDriver()` | 外部队列 + 调度通知 |
| `SessionAlreadyOwnedError` 进程内 | 跨机租约（Redis/etcd/DB row lock） |
| 无全局调度器 | 独立调度组件 |

### 注意点

- 队列分区键和租约 key 都用 `sessionId`，避免「命令在 A、租约在 B」竞态。
- **取消命令要优先**：cancel 带 barrier 或优先队列，避免与旧 prompt 乱序。
- 调度器自身要 HA（Redis Sentinel / etcd 选主），否则变成新单点。

---

## 第三层：Worker 池（有状态执行面）

### 职责

**唯一**允许做这些操作的地方：

- 持有该会话的**写租约**
- `SessionPersistence.open(id, 'write')`
- 内存 **Inbox + agent-loop**（复用今天的 Cordis 组合）
- 调 **LLM**、跑**工具**、`append` / `flush`
- （可选）本地暂存工作区文件，或连远程沙箱

### 一个会话在 Worker 上的生命周期

```
1. 收到调度：负责 session S
2. AcquireLease(S)                    ← 拿租约，带 epoch
3. open(S, 'write')                   ← 独占写句柄
4. 读日志 + interruptedTurnClosers    ← 修复上次中断尾部
5. agents.resume / create             ← 恢复或新建 Agent

6. 循环处理命令:
   - 从队列拉 prompt/steer/cancel
   - 转成本地 followup() / steer() / cancel()
   - loop: claim → pre-step → user/message → LLM → tools → …
   - 每次 append 写集中存储
   - 周期 Heartbeat 续租

7. 空闲策略:
   - 保持热租约（减少 resume 开销）
   - 或 close handle + ReleaseLease

8. 异常/宕机:
   - loop 停止，epoch 作废
   - 新 Worker 用新 epoch 接管
```

### Worker 内部的 Cordis 组合（与今天 DSH 高度重合）

```
session           ctx.sessions（内存日志）
agent-loop        claim → pre-step → deriveMessages → llm.stream
system-prompt     system 段落组装
tools             bash / fs / web 等
compaction        上下文压缩
session-checkpoint-policy  flush 检查点
session-persistence-*      写入集中存储（换 provider）
```

差异只在**边界插件**：

| 今天 | Worker 内 |
|------|-----------|
| `webServer` 提供 HTTP/WS | 不对外；只有队列消费 + 集中存储 |
| `session-persistence-sqlite`（本机文件） | 换成集中式 provider |
| `session/event` 进程内广播 | append 后通知外部总线 |
| `$DSH_HOME` 本地盘 | 对象存储 provider |

### 扩展方式

- **加 Worker** = 加可同时热运行的会话数。
- 单会话仍只在**一台 Worker**上跑（租约保证）。
- 不均靠调度挪空闲会话（释放租约再竞争），不是双开。

### Worker 持有的状态

| 状态 | 位置 | 宕机后果 |
|------|------|----------|
| 租约 epoch | 租约服务 + Worker 内存 | 丢了无法再写，新 Worker 接管 |
| write handle + 热 Session | Worker 进程 | 可从集中存储 resume |
| Inbox 热队列 | 以外部队列为准，内存为投影 | 进程挂了靠队列重放 |
| 进行中的 LLM HTTP 流 | Worker | **无法无损转移**，中断后按日志修复 |
| 工具子进程 / PTY | Worker（或沙箱） | 随机器走，需外置或可重建 |

---

## 第四层：集中式存储（数据权威真源）

### 职责

**所有节点最终只相信这里已提交的内容。**

| 存储类型 | 存什么 | 谁写 | 谁读 |
|----------|--------|------|------|
| **会话事件日志** | header、`user/message`、`assistant/*`、`tool/*`、inbox splice | 仅租约持有者（write handle） | API follow、列表、新 Worker resume、管理端 |
| **对象存储** | 图片/附件字节、工作区大文件、导出 ZIP | Worker 或专用 upload 接口 | LLM 拉取、UI `readAttachment` |
| **元数据** | workspace 分组、sessionIds、settings、标题索引 | 控制面或 Worker | API 侧栏、管理端 |

### 会话日志需要的语义

| 语义 | 说明 |
|------|------|
| **单写者** | 与租约一致；write handle 独占 |
| **仅追加 + seq** | 读者按 seq 追赶；支持 `readFrom(seq)` |
| **flush/提交边界** | 未提交的不对外 follow |
| **多读者** | 多个 API 副本同时读同一会话 |
| **revision/stat** | 调度与缓存失效用 |

> 实现可以是：PostgreSQL（JSONB/字节列）、专用 log store 或「对象存储分段 + 元数据库」。**不是**多机共挂一个 SQLite 文件。

### 事件如何从写到 follow（三种方式）

```
方式 1：Worker append 成功后主动 Publish
  Worker → Publish(sessionId, newSeq) → Redis Stream / NATS
  API follow 订阅 → 收到通知 → readFrom(seq) → 推浏览器

方式 2：数据库 CDC
  DB commit → CDC 捕获 → 事件总线
  API follow 订阅 → …

方式 3：API 轮询
  API follow 定期 stat().revision → 若变化则 readFrom(cursor)
  （实现最简，延迟较高）
```

### 对象存储

- 附件：消息里仍只放 `attachmentId`，字节在 MinIO/OSS（与今天 `attachment-local` 思路一致，换后端）。
- 工作区文件：从 `$DSH_HOME/workspaces/...` 迁移到 bucket 前缀 / 沙箱挂载。
- 上传可走 API 预签名直传，不经 Worker，减轻执行面带宽。

### 与今天 DSH 的差别

| 今天 | 平台化存储层 |
|------|------------|
| `sessions.db` / JSONL 目录 | 网络化、多读者日志存储 |
| `$DSH_HOME/storages` JSON | DB 或对象存储 + 索引 |
| `$DSH_HOME/attachments` | 对象存储（MinIO / OSS） |
| 同进程 `session/event` 即推送 | 存储提交 → 总线 → API |

---

## 跨层消息流：一条用户消息的完整路径

```
┌─ 浏览器 ──────────────────────────────────────────────────────┐
│ 1. 点击发送 → 同步画 submission echo（requestId）             │
│ 2. POST /api/session.prompt + Bearer JWT                     │
└───────────────────────────────────┬──────────────────────────┘
                                    │ HTTP
                                    ▼
┌─ 第一层：API/BFF ──────────────────────────────────────────────┐
│ 3. 校验 JWT + ownerUserId                                     │
│ 4. Enqueue({ sessionId, requestId, content, mode:'queue' })  │
│ 5. 返回 { accepted: true }                                    │
└───────────────────────────────────┬──────────────────────────┘
                                    │ 入命令队列
                                    ▼
┌─ 第二层：队列 + 调度 ───────────────────────────────────────────┐
│ 6. sessionId 分区：命令排队                                    │
│ 7. 若无租约：选 Worker → AcquireLease(sessionId)              │
│ 8. 通知持有者：「session S 有新命令」                           │
└───────────────────────────────────┬──────────────────────────┘
                                    │ 分派给 Worker
                                    ▼
┌─ 第三层：Worker ────────────────────────────────────────────────┐
│ 9.  拉取命令 → 转 followup(UserMessage)                        │
│ 10. turn/start → inbox.claim → pre-step                       │
│ 11. session.append('user/message', …)   ← 写入集中存储         │
│ 12. deriveMessages + system + tools                           │
│ 13. llm.stream() → assistant/chunk* → assistant/message      │
│ 14. 若有工具：tool/call → tools → tool/result                 │
│ 15. turn/end；flush；Publish(sessionId, newSeq)               │
└───────────────────────────────────┬──────────────────────────┘
                 append/flush       │     Publish(newSeq)
                                    ▼
┌─ 第四层：集中存储 ──────┐   ┌─ 事件总线 ──┐
│ events 表：seq 1..N   │   │ sessionId  │
│ 日志持久化             │   │ newSeq 通知 │
└────────────────────────┘   └──────┬──────┘
                                    │ 订阅通知
                                    ▼
┌─ 第一层：API follow ───────────────────────────────────────────┐
│ 16. 收到 newSeq 通知 → readFrom(cursor) → 推 append 帧         │
└───────────────────────────────────┬──────────────────────────┘
                                    │ WS 推送
                                    ▼
┌─ 浏览器 ──────────────────────────────────────────────────────┐
│ 17. follow 收到 user/message（含 rpcId）→ echo 退休           │
│ 18. 收到 assistant/chunk → 流式显示                           │
│ 19. 收到 assistant/message → 渲染完整回复                     │
└───────────────────────────────────────────────────────────────┘
```

---

## 与今天 DSH 单机的对应关系

| 四层模块 | 今天 DSH 对应位置 | 改动量 |
|----------|------------------|--------|
| API/BFF | `session-controller` + `gateway` + `connection` 外壳 | 写路径改入队；follow 改订存储 |
| 队列+调度 | `Inbox` + `wakeDriver`（进程内） | **新建**；Inbox 降为 Worker 内投影 |
| Worker | `agent-loop` + `tools` + `llm` + `system-prompt` + `compaction` | 边界插件替换；核心几乎不变 |
| 集中存储 | `SessionPersistence` seam + `$DSH_HOME` | 实现 **新 provider**；接口兼容 |

### 哪些能原样复用

- `deriveMessages`、`pre-step`、`agent/request`、`tools/*` 整套流水线
- `session-checkpoint-policy`（flush 语义不变）
- compaction、session-projection、session-title 等
- 客户端 Remote 协议（可继续对浏览器保持原样）

---

## 分期演进路径

**可以停在任意阶段，每步独立上线。**

```
阶段 0：单机 DSH（现状）
  - sessions.db + $DSH_HOME 本地
  - 单进程多用户

  ↓ 存储外置

阶段 1：存储分离（L1 可恢复 + 共享持久化）
  - 会话日志 → `@deepseek-ai/dsh-session-persistence-pg`（PostgreSQL）
  - 附件 → `@deepseek-ai/dsh-attachment-s3`（MinIO/S3）
  - 工作区/设置域 → `@deepseek-ai/dsh-storage-pg`（PostgreSQL KV）
  - 组合包：`@deepseek-ai/dsh-platform`（`packages/bundle/platform/cordis.patch.yml`）叠在 multi-user 之上
  - API + Worker 仍合一进程
  - 故障重启后历史恢复，进行中 turn 断

  ↓ 推送解耦

阶段 2：follow 订存储（读写分离）
  - follow 不再依赖 session/event 本进程广播
  - API 副本可多个，同时 follow 同一会话
  - 仍单 Host，但推送路径与执行路径解耦

  ↓ 主备 + API 分进程

阶段 3：主备 + API/Worker 拆分（L2）
  - API 多副本（无 Agent）
  - 仍单 Active Worker（+Standby）
  - VIP 切换整机；故障 ~1 分钟可续
  - 进行中 turn 仍会断，靠日志修复

  ↓ 队列 + 多 Worker

阶段 4：队列 + 租约 + 多 Worker（弱 L3）
  - 命令队列外置（Redis / MQ）
  - 租约：谁持有写权
  - 多 Worker 可同时热运行不同会话
  - 单会话仍绑一台 Worker

  ↓ 对象存储 / 远程沙箱

阶段 5：工具 / 工作区解耦（完整 L3）
  - 工具路径指向对象存储或远程沙箱
  - Worker 可完全无本地盘依赖
  - 会话可随租约迁移到任意 Worker
```

---

## 服务打包建议

### 选 A：最小拆分（推荐起步）

```
服务 1：API + Worker（合一进程，挂 dsh-platform 覆盖层）
服务 2：集中存储（PostgreSQL + MinIO）
（队列/调度用 DB 行锁 + Redis 原语实现 — 本阶段可不做）
```

已交付包：`dsh-session-persistence-pg`、`dsh-attachment-s3`、`dsh-storage-pg`、`dsh-platform`。设计记录：[platform network storage backends](../.agents/notes/implemented/architecture/2026-09-08-platform-network-storage-backends.md)。

适合：**团队 ≤ 3 人，并发会话 < 100，初期产品**

### 选 B：标准拆分

```
服务 1：API/BFF（多副本，无状态）
服务 2：Worker 池（可多机）
基础设施：Redis / MQ（队列+调度）
基础设施：PostgreSQL + MinIO（存储）
```

适合：**SaaS 正式上线，需要不停机发布，并发会话 > 100**

### 选 C：极简主备（L2，不拆层）

```
服务 1：DSH Host Active
服务 2：DSH Host Standby
共享：$DSH_HOME 挂共享盘 / 持续复制
```

适合：**流量小，高可用要求「挂了 1 分钟内能恢复」，不需要水平扩展**

### 决策依据

| 问题 | 建议方案 |
|------|---------|
| 同时在线会话 < 50 | C 或 A |
| 需要不停机滚动升级 | B（API 和 Worker 独立重启） |
| 运维人员 ≤ 2 人 | C 或 A |
| SaaS 多租户，QPS 预期高 | 分期向 B 演进 |
| 合规要求数据审计/隔离 | 存储单独是必须的（A 或 B） |

---

## 关键设计原则

### 1. 模型可见 ⟺ 已记入日志

凡能进入 LLM 请求的内容，都必须先作为 `user/message` 写入会话日志，再由 `deriveMessages()` 投影。**不允许在日志外向 LLM 偷注内容。**

### 2. 单写者是架构保证，不是约定

`SessionHandle(write)` 是写的唯一门，**租约决定谁有资格拿这扇门**。多机下依赖 fencing token（epoch）防脑裂，而不是依赖「大家约好不乱写」。

### 3. 失败恢复靠日志，不靠内存

- Worker 宕机后，新 Worker 从集中存储 `open(read)` → 修复 `interruptedTurnClosers` → resume。
- 进行中的 turn 会中断，但历史不丢。
- 这是今天 `agents.resume` + checkpoint 机制的分布式延伸。

### 4. follow 订已提交状态

API 层的 follow 只推「已提交到存储的事件」，**不推 Worker 内存里未 flush 的内容**。一致性优先于最低延迟。

### 5. 控制面 ≠ 执行面

- **控制面**（API/BFF + 队列调度）：无 Agent、无 write handle、可随时多副本。
- **执行面**（Worker）：有租约、有 write handle、有 loop——有状态，但可迁移。
- 两者通过**命令队列 + 存储**解耦；不直接 RPC。

### 6. 四层是职责，不是强制服务数

根据团队规模和阶段，A/B/C 方案都是合理落地方式。过早拆分带来的运维负担不亚于单机的规模瓶颈。

---

## 附：关键术语

| 术语 | 含义 |
|------|------|
| **租约（Lease）** | 跨机的「会话写所有权」；有 TTL，宕机后自动过期可转移 |
| **Epoch / Fencing Token** | 每次租约交接递增；旧 epoch 的写操作被存储层拒绝 |
| **SessionHandle(write)** | 今天 DSH 的写入唯一门；分布式场景下持有者必须先有租约 |
| **Inbox** | Agent 的待处理消息队列；平台化后以外部命令队列为权威，本地 Inbox 是投影 |
| **interruptedTurnClosers** | Worker 恢复时修复上次中断尾部的机制；来自今天的 `agents.resume` 实现 |
| **`deriveMessages()`** | 从 surface（模型可见日志节点）投影成 LLM 的 `messages[]`；不依赖机器 |
| **pre-step waterfall** | `agent/pre-step` 扩展点；消息中间件（改写/拦截/RAG 注入）的主战场 |
