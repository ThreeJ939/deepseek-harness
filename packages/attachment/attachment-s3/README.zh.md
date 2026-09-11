# @deepseek-ai/dsh-attachment-s3

[English](README.md) | 中文

兼容 S3 的内容寻址附件存储。图片准入与提供者无关的规范化复用 [`dsh-attachment-local`](../attachment-local/README.zh.md)；只有持久对象介质是远端（MinIO 或 AWS S3）。图片对象键保持 `v1/objects/<sha256[0:2]>/<sha256>`； verbatim 文件通过 `saveFileStream` / `readFileStream` 使用 `v1/files/<sha256[0:2]>/<sha256>`。[`dsh-platform`](../../bundle/platform/README.zh.md) 覆盖层通过 `S3_*` 环境变量挂载本包。

## 配置（schemastery）

```ts
interface Config {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
  forcePathStyle?: boolean
  maxImageBytes?: number
  maxImagesPerMessage?: number
  maxMessageImageBytes?: number
  maxImagePixels?: number
  maxImageDimension?: number
  normalizedImageMaxPixels?: number
  normalizedImageMaxDimension?: number
  normalizedImageMaxBytes?: number
  imageCompressionConcurrency?: number
}
```

`region` 默认为 `us-east-1`。`forcePathStyle` 默认为 `true`（适配 MinIO）。图片限额默认值与本地后端一致。

## Model Experience

### Image attachments in model requests

#### What the model sees

与 S3 无关。提供者适配器收到的持久引用与 request-image 字节与本地后端相同；对象键与桶名不会进入提示或工具 schema。

#### Token effect

与本地后端相同：request-image 编码大小受路由的 `ImageRequestPolicy` 约束。

#### KV Cache effect

与本后端无关。request-image 身份跟随 attachment id + policy，而非存储介质。

## Known Limitations and Deferred Work

- **request-image 变体不在桶内缓存** — 每次 `readImageRequest` 都从规范化对象重算；后续可改为写入专用前缀。
- **`imageHostPath` 恒为 undefined** — 需要本地路径的主机工具须经临时文件或其它后端复制。
- **需要可达的 S3 API** — 端点或凭据错误时操作会大声失败。
