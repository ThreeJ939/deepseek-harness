# @deepseek-ai/dsh-attachment-s3

English | [中文](README.zh.md)

S3-compatible content-addressed attachment store. Image admission and provider-independent normalization reuse [`dsh-attachment-local`](../attachment-local/README.md); only the durable object medium is remote (MinIO or AWS S3). Image object keys stay `v1/objects/<sha256[0:2]>/<sha256>`; verbatim files use `v1/files/<sha256[0:2]>/<sha256>` via `saveFileStream` / `readFileStream`. The [`dsh-platform`](../../bundle/platform/README.md) overlay mounts this package with `S3_*` environment variables.

## Configuration (schemastery)

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

`region` defaults to `us-east-1`. `forcePathStyle` defaults to `true` for MinIO. Image limit defaults match the local backend.

## Model Experience

### Image attachments in model requests

#### What the model sees

Nothing specific to S3. Provider adapters receive the same durable references and request-image bytes as with the local backend; object keys and bucket names never enter prompts or tool schemas.

#### Token effect

Same as the local backend: request-image encoding size is bounded by the route's `ImageRequestPolicy`.

#### KV Cache effect

None specific to this backend. Request-image identity follows attachment id + policy, not the storage medium.

## Known Limitations and Deferred Work

- **Request-image variants are not cached in the bucket** — each `readImageRequest` recomputes from the normalized object; a later change may store variants under a dedicated prefix.
- **`imageHostPath` is always undefined** — host tools that require a local path must copy through a temporary file or a different backend.
- **Requires reachable S3 API** — cold operations fail loud when endpoint or credentials are wrong.
