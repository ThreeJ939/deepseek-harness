# 多用户本地启动（PowerShell）

在仓库根目录执行。

## 1. 启动 Web + multi-user patch

`dsh-web-app` 已声明对 `@deepseek-ai/dsh-multi-user` 的依赖，因此 `--patch` 叠层时，profile 的 `$DSH_HOME/profiles/node_modules` 能解析 patch 行里的 `dsh-multi-user`、`dsh-user-path-policy`、`dsh-host-auth-middleware` 等包。改完依赖后若仍报 `Cannot find package`，先再跑一次 `pnpm install`。源码启动前还需构建该组合包（`tsc` + `tsdown`），否则 `lib/index.js` 可能是空壳。

```powershell
$env:DSH_JWT_SECRET = "test-jwt-secret-at-least-32-chars!!"
$env:DSH_AUTH_ALLOW_JWT_PASTE = "1"
$env:DSH_SAAS_USERINFO_URL = "https://example.com/userinfo"
pnpm dsh --profile web --patch packages/bundle/multi-user/cordis.patch.yml
```

- `DSH_JWT_SECRET`：至少 32 字符，与下方签发 JWT 使用同一密钥。
- `DSH_AUTH_ALLOW_JWT_PASTE=1`：登录页允许粘贴 JWT（本地测试）。
- `DSH_SAAS_USERINFO_URL`：`auth-login` 初始化需要；本地仅 JWT 粘贴时可用占位 URL。

浏览器默认：`http://127.0.0.1:3080`

持久启用（不每次 `--patch`）可改为把组合包装进 profile：

```powershell
pnpm dsh plugin --profile web add ./packages/bundle/multi-user
pnpm dsh --profile web
```

## 2. 签发测试 JWT

另开一个 PowerShell 窗口（仍在仓库根目录）：

```powershell
$env:DSH_JWT_SECRET = "test-jwt-secret-at-least-32-chars!!"
node scripts/mint-multi-user-jwt.mjs alice bob
```

将输出的 token 粘贴到登录页。把 `alice` 换成其它用户 id 可签发不同用户的 JWT。