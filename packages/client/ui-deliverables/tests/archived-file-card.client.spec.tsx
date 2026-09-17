// @vitest-environment jsdom
/** Archived file cards expose a download action without Host desktop menus. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { ArchivedFileCard } from '../src/client/ArchivedFileCard.tsx'
import {
  ArchivedDownloadController,
  archivedDownloadHeaders,
  downloadBlob,
} from '../src/client/archive-download.ts'
import { en, zh } from '../src/client/locales.ts'
import { SessionId } from '@deepseek-ai/dsh-session/types'

/** Must match `@deepseek-ai/dsh-client-connection` auth helpers. */
const DSH_AUTH_JWT_KEY = 'dsh.auth.jwt'
const DSH_AUTH_EXPIRED_EVENT = 'dsh-auth-expired'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const file = {
  path: 'out/report.pdf',
  description: 'Final report',
  seq: 4,
  index: 1,
  attachment: {
    attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
    name: 'report.pdf',
    bytes: 128,
  },
}

it('downloads from the card button and reports progress', () => {
  const onDownload = vi.fn()
  const view = render(<ArchivedFileCard file={file} phase={undefined} onDownload={onDownload} t={makeTranslate(en)} />)
  expect(view.getByText('Final report · 128 bytes')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Download out/report.pdf' }))
  expect(onDownload).toHaveBeenCalledOnce()
  view.rerender(<ArchivedFileCard file={file} phase="downloading" onDownload={onDownload} t={makeTranslate(en)} />)
  expect((view.getByRole('button', { name: 'Download out/report.pdf' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.getByText(en['archived.downloading'])).toBeTruthy()
})

it('localizes download failure copy', () => {
  const view = render(<ArchivedFileCard file={file} phase="error" onDownload={() => {}} t={makeTranslate(zh)} />)
  expect(view.getByText(zh['archived.error'])).toBeTruthy()
})

it('GETs with Bearer JWT then saves the response blob', async () => {
  sessionStorage.setItem(DSH_AUTH_JWT_KEY, 'fixture-jwt')
  const fetcher = vi.fn(async () => new Response('archived-bytes', { status: 200 }))
  const save = vi.fn()
  const controller = new ArchivedDownloadController(fetcher, save)
  await controller.download(SessionId('session'), 4, 1, 'report.pdf')
  expect(fetcher).toHaveBeenCalledWith(
    expect.objectContaining({ href: expect.stringContaining('/api/deliverable.download?sessionId=session&seq=4&index=1') }),
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      headers: { authorization: 'Bearer fixture-jwt' },
    }),
  )
  expect(save).toHaveBeenCalledOnce()
  const [blob, filename] = save.mock.calls[0] as [Blob, string]
  expect(filename).toBe('report.pdf')
  expect(blob).toBeInstanceOf(Blob)
  expect(Buffer.from(await blob.arrayBuffer()).toString('utf8')).toBe('archived-bytes')
  expect(controller.state.getSnapshot()['/api/deliverable.download?sessionId=session&seq=4&index=1']).toBe('success')
})

it('omits Authorization when no JWT is stored', () => {
  expect(archivedDownloadHeaders()).toEqual({})
})

it('publishes an error when the GET fails', async () => {
  const controller = new ArchivedDownloadController(async () => new Response('missing', { status: 404 }))
  await controller.download(SessionId('session'), 4, 1, 'report.pdf')
  const url = '/api/deliverable.download?sessionId=session&seq=4&index=1'
  expect(controller.state.getSnapshot()[url]).toBe('error')
  expect(controller.errorOf(url)).toContain('HTTP 404')
})

it('clears an expired JWT and notifies login UI on HTTP 401', async () => {
  sessionStorage.setItem(DSH_AUTH_JWT_KEY, 'stale-jwt')
  const expired = vi.fn()
  globalThis.addEventListener(DSH_AUTH_EXPIRED_EVENT, expired)
  const controller = new ArchivedDownloadController(async () => new Response('unauthorized', { status: 401 }))
  await controller.download(SessionId('session'), 4, 1, 'report.pdf')
  globalThis.removeEventListener(DSH_AUTH_EXPIRED_EVENT, expired)
  expect(sessionStorage.getItem(DSH_AUTH_JWT_KEY)).toBeNull()
  expect(expired).toHaveBeenCalledOnce()
  expect(controller.errorOf('/api/deliverable.download?sessionId=session&seq=4&index=1')).toContain('HTTP 401')
})

it('creates a download anchor for a blob object URL', () => {
  const click = vi.fn()
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:archive')
  const createElement = vi.spyOn(document, 'createElement')
  createElement.mockImplementation(((tag: string) => {
    if (tag === 'a') return { click, set href(_: string) {}, set download(_: string) {} } as unknown as HTMLAnchorElement
    return document.createElement(tag)
  }) as typeof document.createElement)
  downloadBlob(new Blob(['x']), 'archive.bin')
  expect(createObjectURL).toHaveBeenCalledOnce()
  expect(click).toHaveBeenCalledOnce()
  expect(revoke).toHaveBeenCalledWith('blob:archive')
})
