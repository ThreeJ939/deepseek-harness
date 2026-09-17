/** Archived deliverable downloads stream attachment bytes through Connection. */
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type { SessionEventReadRequest } from '@deepseek-ai/dsh-session-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerDeliverableDownload } from '../src/download.ts'
import {
  archivedContentDisposition, archivedDownloadFilename, archivedFileUrl, DELIVERABLE_DOWNLOAD_PATH,
  isArchivedFile,
} from '../src/archived.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-archive-download-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-archive-home-'))
  cleanups.push(() => rm(dshHome, { recursive: true, force: true }))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalAttachmentStore, { dshHome })
  const bytes = Uint8Array.of(80, 75, 0, 255)
  const attachment = await ctx.attachments.saveFile({ data: bytes, name: '报告.docx' })
  const file = {
    path: '报告.docx',
    description: 'Report',
    attachment,
  }
  const readEvent = vi.fn(async (request: SessionEventReadRequest) => {
    if (request.sessionId !== 'owner') throw new SessionQueryError('missing', 'SESSION_QUERY_SESSION_NOT_FOUND')
    if (request.seq !== 7) throw new SessionQueryError('missing', 'SESSION_QUERY_EVENT_NOT_FOUND')
    return {
      session: { cwd },
      target: {
        type: 'deliverables/archived',
        data: { turn: 1, callId: 'archive-call', files: [file] },
      } as SessionEvent,
    }
  })
  ctx.provide('sessionQuery', { readEvent } as never)
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin({
    inject: ['connection', 'sessionQuery', 'attachments'],
    apply: registerDeliverableDownload,
  })
  await fiber
  const handler = connection.createSharedFetchHandler('/api')
  const download = (method: 'GET' | 'HEAD' = 'GET', query = '?sessionId=owner&seq=7&index=0', signal?: AbortSignal) => handler.fetch(new Request(
    `http://localhost${DELIVERABLE_DOWNLOAD_PATH}${query}`, { method, signal: signal ?? null },
  ))
  return { ctx, fiber, file, attachment, bytes, readEvent, download, handler, cwd }
}

describe('Archived deliverable download route', () => {
  it('streams archived attachment bytes with Content-Disposition', async () => {
    const { download, bytes, fiber, file, handler } = await fixture()
    expect(archivedFileUrl(SessionId('owner'), 7, 0)).toBe(`${DELIVERABLE_DOWNLOAD_PATH}?sessionId=owner&seq=7&index=0`)
    expect(archivedDownloadFilename(file.attachment.name)).toBe('报告.docx')
    expect(archivedContentDisposition(file.attachment.name))
      .toBe(`attachment; filename="__.docx"; filename*=UTF-8''${encodeURIComponent('报告.docx')}`)
    const head = await download('HEAD')
    expect(head.status).toBe(200)
    expect(head.headers.get('content-disposition')).toBe(archivedContentDisposition(file.attachment.name))
    expect(head.headers.get('content-length')).toBe('4')
    expect(new Uint8Array(await head.arrayBuffer())).toHaveLength(0)
    const get = await download('GET')
    expect(get.status).toBe(200)
    expect(get.headers.get('content-disposition')).toBe(archivedContentDisposition(file.attachment.name))
    expect(get.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes)
    expect((await handler.fetch(new Request(`http://localhost${DELIVERABLE_DOWNLOAD_PATH}`))).status).toBe(400)
    await fiber.dispose()
    expect((await download()).status).toBe(404)
  })

  it.each(['', '?seq=7&index=0', '?sessionId=owner&index=0', '?sessionId=owner&seq=7',
    '?sessionId=owner&seq=-1&index=0', '?sessionId=owner&seq=7&index=0.1',
    '?sessionId=owner&seq=9007199254740992&index=0', '?sessionId=owner&seq=7&index=9007199254740992',
  ])('rejects invalid coordinates before reading: %s', async (query) => {
    const { download, readEvent } = await fixture()
    expect((await download('GET', query)).status).toBe(400)
    expect(readEvent).not.toHaveBeenCalled()
  })

  it('refuses unrelated Sessions, absent events, and undeclared file indices', async () => {
    const { download, readEvent, cwd } = await fixture()
    expect((await download('GET', '?sessionId=other&seq=7&index=0')).status).toBe(404)
    expect((await download('GET', '?sessionId=owner&seq=8&index=0')).status).toBe(404)
    expect((await download('GET', '?sessionId=owner&seq=7&index=1')).status).toBe(404)
    readEvent.mockResolvedValueOnce({
      session: { cwd },
      target: { type: 'turn/start' } as SessionEvent,
    })
    expect((await download()).status).toBe(404)
  })

  it.each([null, [], 'invalid', {}, { turn: 1, callId: 'call', files: null },
    { turn: 1, callId: 'call', files: [null] }, { turn: 1, callId: 'call', files: [{ path: '' }] },
    {
      turn: 1, callId: 'call',
      files: [{ path: 'a', attachment: { attachmentId: 'bad', name: 'a', bytes: 1 } }],
    },
  ])('refuses malformed recorded archive data: %j', async (data) => {
    const { download, readEvent, cwd } = await fixture()
    readEvent.mockResolvedValueOnce({
      session: { cwd },
      target: { type: 'deliverables/archived', data } as unknown as SessionEvent,
    })
    expect((await download()).status).toBe(404)
  })
})

describe('archived validators', () => {
  it('accepts a complete archived file reference', () => {
    expect(isArchivedFile({
      path: 'out/report.pdf',
      attachment: {
        attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
        name: 'report.pdf',
        bytes: 12,
      },
    })).toBe(true)
    expect(isArchivedFile({ path: 'a', attachment: { attachmentId: 'sha256:zz', name: 'a', bytes: 1 } })).toBe(false)
  })
})
