/**
 * Unit tests for the auth-login token-exchange endpoint.
 */
import { createSecretKey } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { jwtVerify } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuthLoginService from '../src/index.ts'

const SECRET = 'test-jwt-secret-at-least-32-chars!!'

type MockFetch = (url: string, init?: RequestInit) => Promise<Response>

/** Minimal IncomingMessage stub carrying a buffered body. */
function makeReq(method: string, body: string): IncomingMessage {
  const readable = Readable.from(body.length > 0 ? [Buffer.from(body, 'utf8')] : []) as IncomingMessage
  readable.method = method
  return readable
}

/** Minimal ServerResponse stub that captures the status and body. */
function makeRes(): ServerResponse & { capturedStatus: number; capturedBody: string } {
  let capturedStatus = 200
  let capturedBody = ''
  const res = {
    capturedStatus,
    capturedBody,
    writeHead(status: number) { capturedStatus = status; res.capturedStatus = status },
    end(body?: string) { capturedBody = body ?? ''; res.capturedBody = capturedBody },
  } as unknown as ServerResponse & { capturedStatus: number; capturedBody: string }
  return res
}

/** Build an AuthLoginService instance wired for tests (no real Cordis context needed). */
async function makeService(
  mockFetch: MockFetch,
  overrides: { jwtTtlSeconds?: number } = {},
): Promise<AuthLoginService> {
  const svc = Object.create(AuthLoginService.prototype) as AuthLoginService
  // @ts-expect-error — accessing private field for unit test setup
  svc.config = { jwtSecret: SECRET, jwtTtlSeconds: overrides.jwtTtlSeconds }
  // @ts-expect-error — accessing private field for unit test setup
  svc.secretKey = createSecretKey(Buffer.from(SECRET, 'utf8'))
  // @ts-expect-error — accessing private method for tests
  svc._mockFetch = mockFetch
  return svc
}

describe('AuthLoginService.handleExchange (via fetchUserSub)', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a signed JWT on a valid idpToken', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'alice' }),
    })
    const svc = await makeService(mockFetch as unknown as MockFetch)
    // @ts-expect-error — accessing private method for tests
    const sub = await svc.fetchUserSub('good-token', 'https://example.com/userinfo')
    expect(sub).toBe('alice')
  })

  it('throws UserInfoError when the IdP returns 401', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    const svc = await makeService(mockFetch as unknown as MockFetch)
    // @ts-expect-error — accessing private method for tests
    await expect(svc.fetchUserSub('bad-token', 'https://example.com/userinfo'))
      .rejects.toMatchObject({ status: 401 })
  })

  it('throws UserInfoError when the userinfo response has no sub', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: 'alice@example.com' }),
    })
    const svc = await makeService(mockFetch as unknown as MockFetch)
    // @ts-expect-error — accessing private method for tests
    await expect(svc.fetchUserSub('token', 'https://example.com/userinfo'))
      .rejects.toMatchObject({ status: 502 })
  })

  it('rejects non-POST requests with 405', async () => {
    const svc = await makeService(mockFetch as unknown as MockFetch)
    const req = makeReq('GET', '')
    const res = makeRes()
    // @ts-expect-error — accessing private method for tests
    await svc.handleExchange(req, res, 'https://example.com/userinfo')
    expect(res.capturedStatus).toBe(405)
  })

  it('rejects a missing idpToken field with 400', async () => {
    const svc = await makeService(mockFetch as unknown as MockFetch)
    const req = makeReq('POST', JSON.stringify({}))
    const res = makeRes()
    // @ts-expect-error — accessing private method for tests
    await svc.handleExchange(req, res, 'https://example.com/userinfo')
    expect(res.capturedStatus).toBe(400)
  })

  it('issues a verifiable HS256 JWT on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'bob' }),
    })
    const svc = await makeService(mockFetch as unknown as MockFetch)
    const req = makeReq('POST', JSON.stringify({ idpToken: 'valid-token' }))
    const res = makeRes()
    // @ts-expect-error — accessing private method for tests
    await svc.handleExchange(req, res, 'https://example.com/userinfo')
    expect(res.capturedStatus).toBe(200)
    const { jwt } = JSON.parse(res.capturedBody) as { jwt: string; expiresAt: number }
    const { payload } = await jwtVerify(jwt, createSecretKey(Buffer.from(SECRET, 'utf8')), {
      algorithms: ['HS256'],
    })
    expect(payload.sub).toBe('bob')
  })
})
