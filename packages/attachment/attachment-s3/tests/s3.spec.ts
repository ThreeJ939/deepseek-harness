import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import S3AttachmentStore, {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_IMAGES_PER_MESSAGE,
} from '../src/index.ts'
import { CompressionLimiter } from '../src/compression-limiter.ts'

function png1x1(): Uint8Array {
  // Minimal valid 1x1 PNG
  return Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))
}

describe('CompressionLimiter', () => {
  it('runs tasks and serializes beyond concurrency', async () => {
    const limiter = new CompressionLimiter(1)
    let active = 0
    let maxActive = 0
    const task = async (): Promise<number> => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
      return 1
    }
    await Promise.all([limiter.run(task), limiter.run(task), limiter.run(task)])
    expect(maxActive).toBe(1)
  })

  it('wraps non-Error rejections', async () => {
    const limiter = new CompressionLimiter(1)
    await expect(limiter.run(async () => {
      throw 'boom'
    })).rejects.toThrow(/non-Error/)
  })
})

describe('S3AttachmentStore', () => {
  it('exposes default limits', () => {
    expect(DEFAULT_MAX_IMAGE_BYTES).toBeGreaterThan(0)
    expect(DEFAULT_MAX_IMAGES_PER_MESSAGE).toBeGreaterThan(0)
  })

  it('saves and reads through an injected S3 client', async () => {
    const objects = new Map<string, Uint8Array>()
    const client = {
      send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const name = command.constructor.name
        const key = String(command.input['Key'])
        if (name === 'HeadObjectCommand') {
          if (!objects.has(key)) {
            const error = new Error('missing') as Error & { name: string; $metadata: { httpStatusCode: number } }
            error.name = 'NotFound'
            error.$metadata = { httpStatusCode: 404 }
            throw error
          }
          return {}
        }
        if (name === 'PutObjectCommand') {
          const body = command.input['Body'] as Uint8Array
          objects.set(key, body)
          return {}
        }
        if (name === 'GetObjectCommand') {
          const data = objects.get(key)
          if (data === undefined) {
            const error = new Error('missing') as Error & { name: string }
            error.name = 'NoSuchKey'
            throw error
          }
          return { Body: data }
        }
        throw new Error(`unexpected command ${name}`)
      }),
      destroy: vi.fn(),
    }

    const ctx = new Context()
    const attachments = new S3AttachmentStore(ctx, {
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'attachments',
      accessKeyId: 'minio',
      secretAccessKey: 'minio123',
    }, client as never)

    const ref = await attachments.saveImage({
      data: png1x1(),
      mediaType: 'image/png',
      name: 'dot.png',
    })
    expect(String(ref.attachmentId)).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(objects.size).toBe(1)

    const stored = await attachments.readImage(ref)
    expect(stored.data.byteLength).toBe(ref.bytes)
    expect(attachments.imageHostPath(ref)).toBeUndefined()

    const request = await attachments.readImageRequest(ref, { maxPixels: 1_000_000, maxBytes: 1_000_000 })
    expect(request.mediaType).toBe('image/webp')
    expect(request.bytes).toBeGreaterThan(0)

    const again = await attachments.saveImage({
      data: png1x1(),
      mediaType: 'image/png',
    })
    expect(again.attachmentId).toBe(ref.attachmentId)

    await ctx.fiber.dispose()
    expect(client.destroy).toHaveBeenCalled()
  })

  it('rejects an invalid attachment reference', async () => {
    const client = { send: vi.fn(), destroy: vi.fn() }
    const ctx = new Context()
    const attachments = new S3AttachmentStore(ctx, {
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'attachments',
      accessKeyId: 'minio',
      secretAccessKey: 'minio123',
    }, client as never)
    const bad: ImageAttachmentRef = {
      attachmentId: AttachmentId('not-a-digest'),
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    }
    await expect(attachments.readImage(bad)).rejects.toThrow(/invalid/i)
    await ctx.fiber.dispose()
  })

  it('validates a batch before saving', async () => {
    const client = { send: vi.fn(), destroy: vi.fn() }
    const ctx = new Context()
    const attachments = new S3AttachmentStore(ctx, {
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'attachments',
      accessKeyId: 'minio',
      secretAccessKey: 'minio123',
      maxImagesPerMessage: 1,
    }, client as never)
    await expect(attachments.saveImages([
      { data: png1x1(), mediaType: 'image/png' },
      { data: png1x1(), mediaType: 'image/png' },
    ])).rejects.toThrow(/image-count/i)
    await ctx.fiber.dispose()
  })
})
