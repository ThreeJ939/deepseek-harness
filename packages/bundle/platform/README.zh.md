# @deepseek-ai/dsh-platform

[English](README.md) | 中文

面向方案 A 平台化的网络存储覆盖组合包。[`cordis.patch.yml`](cordis.patch.yml) 禁用本地 SQLite 会话持久化、本地附件与 JSON storage；挂载 [`dsh-session-persistence-pg`](../../session/session-persistence-pg/README.zh.md)、[`dsh-attachment-s3`](../../attachment/attachment-s3/README.zh.md) 与 [`dsh-storage-pg`](../../storage/storage-pg/README.zh.md)；并将 `storage-domain` 指向后端 `pg`。

叠加在 multi-user 组合之上，例如：

```text
dsh.profile.bundles:
  - @deepseek-ai/dsh-base
  - @deepseek-ai/dsh-web-app
  - @deepseek-ai/dsh-multi-user
  - @deepseek-ai/dsh-platform
```

必需环境变量：`DATABASE_URL`、`S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`。可选：`PG_POOL_SIZE`、`S3_REGION`（默认 `us-east-1`）、`S3_FORCE_PATH_STYLE`（默认启用；设为 `0` 关闭）。`DATABASE_URL` 使用标准 Postgres 连接串（账号密码写在 URL 内）。本地启停见 [multi-user LOCAL-DEV](../multi-user/LOCAL-DEV.zh.md)。须用 `dsh plugin … add` 安装本组合包（或写入 `dsh.profile.bundles`）；在默认 web profile 上仅 `--patch` 本覆盖层无法解析其 provider 包。勿对同一组合包同时 `plugin add` 与 `--patch`。

设计记录：[platform network storage backends Agent Note](../../../.agents/notes/implemented/architecture/2026-09-08-platform-network-storage-backends.zh.md)。

## Model Experience

作为组合包无独立模型面；被挂载插件保留各自的模型可见面。

不发布不变式伴生入口，因为本包是静态 patch 列表载体；每条插入的 provider 负责该行的不变式，组合包自身没有任何可检查的可变关系。

## Known Limitations and Deferred Work

- **仍是单 Host 进程** — API 与 Worker 仍同进程；队列/租约水平扩展不在本覆盖层范围内。
- **环境变量驱动接线** — 缺少 `DATABASE_URL` 或 S3 凭据会在插件加载时失败，而不会回退到本地盘。
