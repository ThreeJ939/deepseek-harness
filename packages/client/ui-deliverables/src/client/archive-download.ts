/** Browser download state for archived deliverable cards. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { archivedDownloadFilename, archivedFileUrl } from '../archived.ts'

/** Must match `@deepseek-ai/dsh-client-connection` auth helpers. */
const DSH_AUTH_JWT_KEY = 'dsh.auth.jwt'
const DSH_AUTH_EXPIRED_EVENT = 'dsh-auth-expired'

/** Download phases presented on an archived file card. */
export type ArchivedDownloadPhase = 'downloading' | 'success' | 'error'

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>
type Save = (blob: Blob, filename: string) => void

/** Read the multi-user JWT from sessionStorage when present. */
function readAuthJwt(): string | undefined {
  try {
    if (typeof globalThis.sessionStorage === 'undefined') return undefined
    const value = globalThis.sessionStorage.getItem(DSH_AUTH_JWT_KEY)
    return value === null || value.length === 0 ? undefined : value
  } catch {
    // sessionStorage may throw in opaque/sandboxed origins.
    return undefined
  }
}

/** Clear JWT and notify login UI when the download carrier rejects an expired token. */
function notifyAuthExpired(): void {
  try {
    if (typeof globalThis.sessionStorage !== 'undefined') {
      globalThis.sessionStorage.removeItem(DSH_AUTH_JWT_KEY)
    }
  } catch {
    // sessionStorage may throw in opaque/sandboxed origins.
  }
  globalThis.dispatchEvent(new Event(DSH_AUTH_EXPIRED_EVENT))
}

/**
 * Build request headers for one Host download, including Bearer JWT when multi-user auth is active.
 * @returns headers suitable for `fetch` init.
 */
export function archivedDownloadHeaders(): HeadersInit {
  const jwt = readAuthJwt()
  return jwt === undefined ? {} : { authorization: `Bearer ${jwt}` }
}

/**
 * Save a fetched attachment blob through a temporary object URL.
 * @param blob - response body bytes.
 * @param filename - browser download filename.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    anchor.click()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** Resolve the browser's Host base with the connection carrier's null-origin fallback. */
function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns one in-flight archived download per file coordinates. */
export class ArchivedDownloadController {
  /** Phase keyed by archivedFileUrl coordinates. */
  readonly state: SnapshotStore<Record<string, ArchivedDownloadPhase | undefined>> = createSnapshotStore({})

  private readonly errors = new Map<string, string>()
  private readonly active = new Map<string, { readonly abort: AbortController; readonly done: Promise<void> }>()
  private disposed = false

  /**
   * @param fetcher - HTTP carrier used for the authenticated GET.
   * @param save - browser save operation for the response blob.
   */
  constructor(
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
    private readonly save: Save = downloadBlob,
  ) {}

  /**
   * Read the latest error text for one download URL, if any.
   * @param url - archivedFileUrl coordinates.
   * @returns the last published error message, or undefined.
   */
  errorOf(url: string): string | undefined {
    return this.errors.get(url)
  }

  /**
   * Download one archived attachment; concurrent gestures for the same coordinates share one operation.
   * @param sessionId - Session that owns the archive event.
   * @param seq - durable archive event sequence.
   * @param index - original file index within that event.
   * @param filename - browser download filename from the attachment leaf name.
   * @returns after the browser save starts, an error state is published, or a late post-disposal request is ignored.
   */
  download(sessionId: SessionId, seq: number, index: number, filename: string): Promise<void> {
    const url = archivedFileUrl(sessionId, seq, index)
    const existing = this.active.get(url)
    if (existing !== undefined) return existing.done
    if (this.disposed) return Promise.resolve()
    const abort = new AbortController()
    const done = this.run(url, archivedDownloadFilename(filename), abort.signal).finally(() => {
      this.active.delete(url)
    })
    this.active.set(url, { abort, done })
    return done
  }

  /**
   * Abort active fetches and reach quiescence.
   * @returns after every active operation settles.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const active = [...this.active.values()]
    for (const operation of active) operation.abort.abort()
    await Promise.allSettled(active.map(operation => operation.done))
  }

  private async run(url: string, filename: string, signal: AbortSignal): Promise<void> {
    this.errors.delete(url)
    this.state.update((state) => { state[url] = 'downloading' })
    try {
      const absolute = new URL(url, hostBase())
      const response = await this.fetcher(absolute, {
        method: 'GET',
        signal,
        headers: archivedDownloadHeaders(),
        credentials: 'same-origin',
      })
      if (response.status === 401) {
        notifyAuthExpired()
        throw new Error(`Download failed: HTTP 401${await detailOf(response)}`)
      }
      if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}${await detailOf(response)}`)
      }
      this.save(await response.blob(), filename)
      this.state.update((state) => { state[url] = 'success' })
    } catch (error: unknown) {
      if (signal.aborted) return
      this.errors.set(url, messageOf(error))
      this.state.update((state) => { state[url] = 'error' })
    }
  }
}

async function detailOf(response: Response): Promise<string> {
  const detail = await response.text().catch(() => '')
  return detail === '' ? '' : ` ${detail}`
}
