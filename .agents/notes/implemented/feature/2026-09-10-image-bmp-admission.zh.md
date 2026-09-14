# Agent Note: 在图片附件路径准入 BMP

Status: implemented

[English](2026-09-10-image-bmp-admission.md) | 中文

## Problem

Windows 截屏与画图流程常产生 `image/bmp`。作曲器图片路径原先只接受 `png|jpeg|webp|gif`，BMP 会被软路由到原样文件路径，像素永远进不了视觉模型。

## Decision

**把 `image/bmp` 扩入 `ImageMediaType`。** 本地与 S3 附件存储在 `mediaTypes` 中列出 BMP；sharp 检测映射 `bmp`；规范化对 BMP 不做字节级透传（与 GIF 相同），并对 BMP 源跳过 alpha 校验。客户端 `createDrafts` / MIME 校验、`read_image` 扩展名嗅探、会话日志导出扩展名、LLM handle 文本，以及 DeepSeek Files API 文件名扩展名均跟随该闭合联合类型。

## Alternatives considered

**BMP 仅走文件路径** — 拒绝：截屏必须进入视觉请求路径，而不是 handle 文本投影。

**在浏览器对空 MIME 做魔数嗅探当图片** — 延后；浏览器声明的 `image/bmp` 已覆盖常见截屏场景，无需第二条客户端解码路径。

## Consequences

挂载 `attachment-local` 或 `attachment-s3` 的部署无需改配置即可在 prompt 准入时接受 BMP。请求投影仍会在调用模型前把 BMP 重编码为 jpeg/webp（或 S3 的 WebP）。
