/**
 * S3-compatible content-addressed attachment store (MinIO / AWS S3).
 * Image admission and normalization reuse `@deepseek-ai/dsh-attachment-local`;
 * only the durable object medium is remote. Verbatim files use a separate
 * `v1/files/` key prefix from normalized images.
 * @module @deepseek-ai/dsh-attachment-s3
 */

import { createHash } from 'node:crypto'
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  AttachmentError,
  AttachmentId,
  AttachmentStore,
  ImageVariantId,
  requestImageDimensions,
} from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveFileStreamAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import {
  prepareImageFile,
  validateImageFile,
  type NormalizationPolicy,
} from '@deepseek-ai/dsh-attachment-local'
import sharp from 'sharp'
import { CompressionLimiter } from './compression-limiter.ts'

/** Default maximum encoded bytes for one submitted image. */
export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** Default maximum images in one prompt. */
export const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20
/** Default maximum aggregate image bytes in one prompt. */
export const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 200 * 1024 * 1024
/** Default maximum intrinsic pixels for one submitted image. */
export const DEFAULT_MAX_IMAGE_PIXELS = 64_000_000
/** Default per-side pixel cap for one submitted image. */
export const DEFAULT_MAX_IMAGE_DIMENSION = 8192
/** Default total-pixel budget of the stored normalized image. */
export const DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS = 2048 * 2048
/** Default long-edge cap of the stored normalized image. */
export const DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION = 8192
/** Default encoded-byte target for one stored normalized image. */
export const DEFAULT_NORMALIZED_IMAGE_MAX_BYTES = 4 * 1024 * 1024
/** Default simultaneous native image transformations per store. */
export const DEFAULT_IMAGE_COMPRESSION_CONCURRENCY = 2
/** Maximum configurable native image transformations per store. */
export const MAX_IMAGE_COMPRESSION_CONCURRENCY = 8

const ID_PATTERN = /^sha256:([a-f0-9]{64})$/
const REQUEST_TRANSFORM_VERSION = 'request-image-s3-v1'

/** Plugin configuration. */
export interface Config {
  /** S3 API endpoint (for MinIO, e.g. `http://127.0.0.1:9000`). */
  endpoint: string
  /** Target bucket name. */
  bucket: string
  /** Access key id. */
  accessKeyId: string
  /** Secret access key. */
  secretAccessKey: string
  /** AWS region; defaults to `us-east-1` (MinIO accepts any). */
  region?: string
  /** Force path-style addressing (required for most MinIO deployments). */
  forcePathStyle?: boolean
  /** Maximum encoded bytes accepted for one submitted image. */
  maxImageBytes?: number
  /** Maximum image count accepted in one submitted message. */
  maxImagesPerMessage?: number
  /** Maximum aggregate encoded image bytes accepted in one submitted message. */
  maxMessageImageBytes?: number
  /** Maximum intrinsic width multiplied by height. */
  maxImagePixels?: number
  /** Maximum intrinsic width and height. */
  maxImageDimension?: number
  /** Total-pixel budget of the stored normalized image. */
  normalizedImageMaxPixels?: number
  /** Long-edge pixel cap of the stored normalized image. */
  normalizedImageMaxDimension?: number
  /** Encoded-byte target of the stored normalized image. */
  normalizedImageMaxBytes?: number
  /** Maximum simultaneous normalization or request-image transformations. */
  imageCompressionConcurrency?: number
}

function objectKey(sha256: string): string {
  return `v1/objects/${sha256.slice(0, 2)}/${sha256}`
}

function fileObjectKey(sha256: string): string {
  return `v1/files/${sha256.slice(0, 2)}/${sha256}`
}

function fileLeafName(value: string | undefined): string {
  if (value === undefined) return 'file'
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  return clean === '' ? 'file' : clean
}

function ensureAttachmentSha(ref: { readonly attachmentId: string }): string {
  const match = ID_PATTERN.exec(String(ref.attachmentId))
  if (match?.[1] === undefined) {
    throw new AttachmentError('Attachment reference is invalid.', 'INVALID_ATTACHMENT_REF')
  }
  return match[1]
}

function isNotFound(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number }; name?: string }).$metadata?.httpStatusCode
  const name = (error as { name?: string }).name
  return status === 404 || name === 'NotFound' || name === 'NoSuchKey'
}

function requestVariantId(ref: ImageAttachmentRef, policy: ImageRequestPolicy): ImageVariantId {
  const digest = createHash('sha256')
    .update(String(ref.attachmentId))
    .update('\0')
    .update(String(policy.maxPixels))
    .update('\0')
    .update(String(policy.maxBytes))
    .update('\0')
    .update(REQUEST_TRANSFORM_VERSION)
    .digest('hex')
  return ImageVariantId(`sha256:${digest}`)
}

async function streamToBuffer(body: unknown): Promise<Uint8Array> {
  if (body === undefined || body === null) {
    throw new AttachmentError('Attachment object is empty.', 'ATTACHMENT_NOT_FOUND')
  }
  if (body instanceof Uint8Array) return body
  if (Buffer.isBuffer(body)) return new Uint8Array(body)
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
  }
  const chunks: Uint8Array[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer))
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function* bufferChunks(data: Uint8Array, chunkSize = 1 << 16): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
    yield data.subarray(offset, Math.min(offset + chunkSize, data.byteLength))
  }
}

/** Content-addressed S3 attachment store. */
export class S3AttachmentStore extends AttachmentStore {
  static Config: z<Config> = z.object({
    endpoint: z.string().required(),
    bucket: z.string().required(),
    accessKeyId: z.string().required(),
    secretAccessKey: z.string().required(),
    region: z.string().default('us-east-1'),
    forcePathStyle: z.boolean().default(true),
    maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
    maxImagesPerMessage: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_MESSAGE),
    maxMessageImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_IMAGE_BYTES),
    maxImagePixels: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_PIXELS),
    maxImageDimension: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_DIMENSION),
    normalizedImageMaxPixels: z.number().step(1).min(1).default(DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS),
    normalizedImageMaxDimension: z.number().step(1).min(1).default(DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION),
    normalizedImageMaxBytes: z.number().step(1).min(1).default(DEFAULT_NORMALIZED_IMAGE_MAX_BYTES),
    imageCompressionConcurrency: z.number().step(1).min(1).max(MAX_IMAGE_COMPRESSION_CONCURRENCY)
      .default(DEFAULT_IMAGE_COMPRESSION_CONCURRENCY),
  })

  readonly imageLimits: ImageAttachmentLimits
  readonly normalizationPolicy: Readonly<NormalizationPolicy>
  readonly imageCompressionConcurrency: number
  private readonly client: S3Client
  private readonly bucket: string
  private readonly compression: CompressionLimiter

  constructor(ctx: Context, config: Config, client?: S3Client) {
    super(ctx)
    this.bucket = config.bucket
    this.client = client ?? new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? 'us-east-1',
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
    this.imageLimits = Object.freeze({
      maxImageBytes: config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
      maxImagesPerMessage: config.maxImagesPerMessage ?? DEFAULT_MAX_IMAGES_PER_MESSAGE,
      maxMessageImageBytes: config.maxMessageImageBytes ?? DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
      maxImagePixels: config.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS,
      maxImageDimension: config.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION,
      mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'] as const),
    })
    this.normalizationPolicy = Object.freeze({
      maxPixels: config.normalizedImageMaxPixels ?? DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS,
      maxDimension: config.normalizedImageMaxDimension ?? DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
      maxBytes: config.normalizedImageMaxBytes ?? DEFAULT_NORMALIZED_IMAGE_MAX_BYTES,
    })
    const compressionConcurrency = config.imageCompressionConcurrency ?? DEFAULT_IMAGE_COMPRESSION_CONCURRENCY
    this.imageCompressionConcurrency = compressionConcurrency
    this.compression = new CompressionLimiter(compressionConcurrency)
    ctx.effect(() => () => {
      this.client.destroy()
    }, 'attachment-s3.client')
  }

  async validateImage(input: SaveImageAttachment): Promise<void> {
    await this.compression.run(() => validateImageFile(input, this.imageLimits, this.normalizationPolicy))
  }

  override async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    this.validateImageBatch(inputs)
    const prepared = await Promise.all(inputs.map(input => this.compression.run(
      () => prepareImageFile(input, this.imageLimits, this.normalizationPolicy),
    )))
    const refs: ImageAttachmentRef[] = []
    for (const image of prepared) {
      refs.push(await this.commitPrepared(image.data, image.ref))
    }
    return refs
  }

  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const prepared = await this.compression.run(
      () => prepareImageFile(input, this.imageLimits, this.normalizationPolicy),
    )
    return this.commitPrepared(prepared.data, prepared.ref)
  }

  async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    signal?.throwIfAborted()
    const sha256 = ensureAttachmentSha(ref)
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey(sha256),
    }), signal === undefined ? undefined : { abortSignal: signal })
    const data = await streamToBuffer(response.Body)
    const digest = createHash('sha256').update(data).digest('hex')
    if (digest !== sha256) {
      throw new AttachmentError('Stored attachment bytes do not match the reference digest.', 'ATTACHMENT_CORRUPT')
    }
    if (data.byteLength !== ref.bytes) {
      throw new AttachmentError('Stored attachment size does not match the reference.', 'ATTACHMENT_CORRUPT')
    }
    return { ref, data }
  }

  override imageHostPath(_ref: ImageAttachmentRef): string | undefined {
    return undefined
  }

  override async readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    const stored = await this.readImage(ref, signal)
    return this.compression.run(() => this.projectRequest(stored, policy, signal))
  }

  override async saveFileStream(input: SaveFileStreamAttachment): Promise<FileAttachmentRef> {
    const hash = createHash('sha256')
    const chunks: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of input.data) {
      input.signal?.throwIfAborted()
      hash.update(chunk)
      chunks.push(chunk)
      bytes += chunk.byteLength
    }
    const sha256 = hash.digest('hex')
    const key = fileObjectKey(sha256)
    const body = Buffer.concat(chunks)
    const ref: FileAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${sha256}`),
      name: fileLeafName(input.name),
      bytes,
      ...(input.mediaType !== undefined && input.mediaType !== '' ? { mediaType: input.mediaType } : {}),
    }
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return ref
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error
    }
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: input.mediaType ?? 'application/octet-stream',
      ContentLength: bytes,
    }))
    return ref
  }

  override async *readFileStream(
    ref: FileAttachmentRef,
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    signal?.throwIfAborted()
    const sha256 = ensureAttachmentSha(ref)
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: fileObjectKey(sha256),
    }), signal === undefined ? undefined : { abortSignal: signal })
    const data = await streamToBuffer(response.Body)
    const digest = createHash('sha256').update(data).digest('hex')
    if (digest !== sha256 || data.byteLength !== ref.bytes) {
      throw new AttachmentError('Stored file attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
    }
    yield* bufferChunks(data)
  }

  private async commitPrepared(data: Uint8Array, ref: ImageAttachmentRef): Promise<ImageAttachmentRef> {
    const sha256 = ensureAttachmentSha(ref)
    const key = objectKey(sha256)
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return ref
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error
    }
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: ref.mediaType,
      ContentLength: data.byteLength,
    }))
    return ref
  }

  private async projectRequest(
    stored: StoredImageAttachment,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    const target = requestImageDimensions(stored.ref.width, stored.ref.height, policy.maxPixels)
    let pipeline = sharp(Buffer.from(stored.data), { failOn: 'none' }).rotate()
    if (target.width !== stored.ref.width || target.height !== stored.ref.height) {
      pipeline = pipeline.resize(target.width, target.height, { fit: 'inside', withoutEnlargement: true })
    }
    const { data, info } = await pipeline.webp({ quality: 80, effort: 4 }).toBuffer({ resolveWithObject: true })
    if (data.byteLength > policy.maxBytes) {
      const tighter = await sharp(data).webp({ quality: 50, effort: 4 }).toBuffer({ resolveWithObject: true })
      return this.requestAttachment(
        stored.ref,
        policy,
        tighter.data,
        tighter.info.width,
        tighter.info.height,
        tighter.info.hasAlpha === true,
      )
    }
    return this.requestAttachment(stored.ref, policy, data, info.width, info.height, info.hasAlpha === true)
  }

  private requestAttachment(
    attachment: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    data: Uint8Array,
    width: number,
    height: number,
    hasAlpha: boolean,
  ): RequestImageAttachment {
    return {
      variantId: requestVariantId(attachment, policy),
      attachment,
      data,
      mediaType: 'image/webp',
      bytes: data.byteLength,
      width,
      height,
      depth: 'uchar',
      space: 'srgb',
      hasAlpha,
    }
  }
}

export default S3AttachmentStore
