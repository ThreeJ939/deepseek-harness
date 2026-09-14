# 多用户 / 平台本地启动（PowerShell）

在仓库根目录执行。默认 Web UI：`http://127.0.0.1:3080`。组合层顺序始终是：`dsh-base` → `dsh-web-app` →（可选）`dsh-multi-user` →（可选）`dsh-platform`。

## 前置条件

1. 已 `pnpm install`，并已 `pnpm run build`（源码启动读 `lib/`；相关包未构建会失败）。
2. 确认 `%USERPROFILE%\.dsh\profiles\web\package.json` 的 `dsh.profile.bundles`：已列出的组合包不要再对其 `--patch`。
3. **包解析差异（重要）**
  - `dsh-multi-user`：`dsh-web-app` 已声明依赖，仅 `--patch` 通常能解析其插件包。
  - `dsh-platform`：web-app **未**声明依赖；仅 `--patch platform` 会报 `Cannot find package '@deepseek-ai/dsh-session-persistence-pg'`（以及 `attachment-s3` / `storage-pg`）。必须先把 platform 装进 profile（方式 B），或至少 `plugin add` platform 以装入依赖闭包。

## 两种启用方式（同一组合包勿混用）


| 方式                  | 做法                                                | 适用                      |
| ------------------- | ------------------------------------------------- | ----------------------- |
| A. `--patch`        | 启动时 `--patch` 叠仓库里的 `cordis.patch.yml`            | multi-user 临时试验         |
| B. `dsh plugin add` | 写入 profile `dependencies` + `dsh.profile.bundles` | platform **必须**；或日常持久启用 |


**勿混用：** bundles 已有 `dsh-multi-user` 时再 `--patch` multi-user → `duplicate loader entry id: auth-middleware`。platform 同理。

卸掉 profile 组合包（改回未安装状态）：

```powershell
pnpm dsh plugin --profile web remove @deepseek-ai/dsh-multi-user
pnpm dsh plugin --profile web remove @deepseek-ai/dsh-platform
```

卸完后 `bundles` 应只剩 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`。

---

## 推荐：multi-user + platform（装进 profile）

```powershell
pnpm dsh plugin --profile web add ./packages/bundle/multi-user
pnpm dsh plugin --profile web add ./packages/bundle/platform
```

每次启动（先设环境变量，见下节）：

```powershell
pnpm dsh --profile web
```

不要再加 multi-user / platform 的 `--patch`。

---

## 仅 multi-user（`--patch`，会话仍用本地 SQLite）

```powershell
$env:DSH_JWT_SECRET = "test-jwt-secret-at-least-32-chars!!"
$env:DSH_AUTH_ALLOW_JWT_PASTE = "1"
$env:DSH_SAAS_USERINFO_URL = "https://example.com/userinfo"
pnpm dsh --profile web --patch packages/bundle/multi-user/cordis.patch.yml
```

要求：profile **未**安装 multi-user。

---

## 混合：`--patch` multi-user + 已安装 platform

若希望 multi-user 仍用 `--patch`，但要用 Postgres/MinIO，先只装 platform（把三个后端包装进解析路径并启用其 patch），再叠 multi-user：

```powershell
pnpm dsh plugin --profile web add ./packages/bundle/platform
# 设 JWT + DATABASE_URL + S3_* 后：
pnpm dsh --profile web --patch packages/bundle/multi-user/cordis.patch.yml
```

要求：profile **未**安装 multi-user；**不要**再 `--patch platform`。

---

## 环境变量

### multi-user

```powershell
$env:DSH_JWT_SECRET = "test-jwt-secret-at-least-32-chars!!"
$env:DSH_AUTH_ALLOW_JWT_PASTE = "1"
$env:DSH_SAAS_USERINFO_URL = "https://example.com/userinfo"
```

### platform（另需）

```powershell
$env:DATABASE_URL = "postgresql://root:123456@192.168.70.8:15432/yx-agent"
$env:S3_ENDPOINT = "http://192.168.70.8:9000"
$env:S3_BUCKET = "agent-attachments"
$env:S3_ACCESS_KEY = "minioadmin"
$env:S3_SECRET_KEY = "minioadmin"
# 可选：PG_POOL_SIZE、S3_REGION（默认 us-east-1）、S3_FORCE_PATH_STYLE=0 关闭路径风格
```

`DATABASE_URL` 为标准连接串（账号密码写在 URL 内）。字段说明见 `[dsh-platform` README](../platform/README.zh.md)。也可用 profile / `$DSH_HOME` 的 `cordis.patch.yml` 写字面量配置；勿把密钥提交进仓库。


| 变量                         | 何时需要       | 说明                                   |
| -------------------------- | ---------- | ------------------------------------ |
| `DSH_JWT_SECRET`           | multi-user | ≥32 字符；与签发 JWT 同源                    |
| `DSH_AUTH_ALLOW_JWT_PASTE` | 本地测登录      | `1` = 登录页可粘贴 JWT                     |
| `DSH_SAAS_USERINFO_URL`    | multi-user | `auth-login` 初始化需要；仅粘贴 JWT 时可用占位 URL |
| `DATABASE_URL`             | platform   | Postgres 连接串                         |
| `S3_*`                     | platform   | MinIO / S3 兼容端点                      |


---

## 签发测试 JWT

另开 PowerShell（仓库根目录）：

```powershell
$env:DSH_JWT_SECRET = "test-jwt-secret-at-least-32-chars!!"
node scripts/mint-multi-user-jwt.mjs alice bob
```

把输出的 token 粘贴到登录页。

---

## 常见问题


| 现象                                                                                                | 处理                                                                                       |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Cannot find package '@deepseek-ai/dsh-session-persistence-pg'`（或 `attachment-s3` / `storage-pg`） | 仅 `--patch platform` 不够；先 `pnpm dsh plugin --profile web add ./packages/bundle/platform` |
| `duplicate loader entry id: auth-middleware`                                                      | multi-user 叠了两次：`remove` 或去掉对应 `--patch`                                                 |
| 缺 `DATABASE_URL` / S3 凭据                                                                          | platform 加载失败，不回退本地盘                                                                     |
| `lib/index.js` 空壳 / 异常                                                                            | `pnpm run build`                                                                         |
