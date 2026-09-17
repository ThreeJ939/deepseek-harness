/** Authenticated streaming download of archived deliverable attachments. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import {
  archivedContentDisposition,
  DELIVERABLE_DOWNLOAD_PATH,
  isArchivedData,
  isArchivedFile,
} from './archived.ts'

/**
 * Register archived-file download inside Connection's authentication fence.
 * @param ctx - Session lookup, attachment store, and route lifetime.
 */
export function registerDeliverableDownload(ctx: Context): void {
  const lifetime = new AbortController()
  const pending = new Set<Promise<Response>>()
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled(pending)
  })
  ctx.connection.fetch.register({
    path: DELIVERABLE_DOWNLOAD_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: (request) => {
      const task = handleDeliverableDownload(ctx, new Request(request, {
        signal: AbortSignal.any([request.signal, lifetime.signal]),
      }))
      pending.add(task)
      void task.then(() => { pending.delete(task) }, () => { pending.delete(task) })
      return task
    },
  })
}

async function handleDeliverableDownload(ctx: Context, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const id = query.get('sessionId')
  const seq = query.get('seq')
  const index = query.get('index')
  if (!id || seq === null || index === null || !/^\d+$/.test(seq) || !/^\d+$/.test(index)
    || !Number.isSafeInteger(Number(seq)) || !Number.isSafeInteger(Number(index))) {
    return new Response('Invalid archived file coordinates.', { status: 400 })
  }
  try {
    request.signal.throwIfAborted()
    const { target } = await ctx.sessionQuery.readEvent({
      sessionId: id as SessionId, seq: Number(seq) as SessionSeq, before: 0, after: 0,
    }, request.signal)
    const file = target.type === 'deliverables/archived' && isArchivedData(target.data)
      ? target.data.files[Number(index)]
      : undefined
    if (!isArchivedFile(file)) return new Response('Archived file not found in this Session result.', { status: 404 })
    request.signal.throwIfAborted()
    const headers = new Headers({
      'content-type': file.attachment.mediaType ?? 'application/octet-stream',
      'content-disposition': archivedContentDisposition(file.attachment.name),
      'cache-control': 'no-store',
      'content-length': String(file.attachment.bytes),
    })
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers })
    }
    const stream = readableFromChunks(ctx.attachments.readFileStream(file.attachment, request.signal))
    return new Response(stream, { status: 200, headers })
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    const remote = remoteErrorOf(error)
    const missing = remote?.code === 'session/not-found'
      || error instanceof Error && 'code' in error
      && (error.code === 'SESSION_QUERY_SESSION_NOT_FOUND' || error.code === 'SESSION_QUERY_EVENT_NOT_FOUND'
        || error.code === 'ATTACHMENT_NOT_FOUND')
    return new Response('Archived file unavailable.', { status: missing ? 404 : 500 })
  }
}

/**
 * Bridge an attachment byte iterator into a WHATWG ReadableStream for Response.
 * @param chunks - verified attachment chunks.
 * @returns a pull-driven byte stream.
 */
function readableFromChunks(chunks: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) {
          controller.close()
          return
        }
        controller.enqueue(next.value)
      } catch (error: unknown) {
        controller.error(error)
      }
    },
    cancel(reason) {
      void iterator.return?.(reason)
    },
  })
}
