/**
 * Multi-tenant JWT identity tests for auth-middleware.
 */
import { createSecretKey } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { SignJWT, jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'
import AuthMiddlewareService from '../src/index.ts'
import { UserId } from '../src/types.ts'

const SECRET = 'test-jwt-secret-at-least-32-chars!!'

async function mintToken(sub: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
}

/** Minimal IncomingMessage stub for authenticateRequest tests. */
function makeReq(headers: Record<string, string>, url: string): IncomingMessage {
  return { headers, url } as unknown as IncomingMessage
}

describe('auth-middleware types', () => {
  it('brands UserId without changing the string', () => {
    expect(UserId('alice')).toBe('alice')
  })
})

describe('JWT mint/verify round-trip', () => {
  it('embeds sub as the user identity', async () => {
    const token = await mintToken('user-a')
    const { payload } = await jwtVerify(token, createSecretKey(Buffer.from(SECRET, 'utf8')), {
      algorithms: ['HS256'],
    })
    expect(payload.sub).toBe('user-a')
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await mintToken('user-a')
    await expect(jwtVerify(
      token,
      createSecretKey(Buffer.from('other-secret-at-least-32-characters!', 'utf8')),
      { algorithms: ['HS256'] },
    )).rejects.toThrow()
  })
})

describe('AuthMiddlewareService.authenticateRequest', () => {
  async function makeService(): Promise<AuthMiddlewareService> {
    const svc = Object.create(AuthMiddlewareService.prototype) as AuthMiddlewareService
    // @ts-expect-error — accessing private field for unit test setup
    svc.config = {}
    // @ts-expect-error — accessing private field for unit test setup
    svc.secretKey = createSecretKey(Buffer.from(SECRET, 'utf8'))
    return svc
  }

  it('accepts a Bearer token from Authorization header', async () => {
    const svc = await makeService()
    const token = await mintToken('alice')
    const result = await svc.authenticateRequest(makeReq({ authorization: `Bearer ${token}` }, '/api/session.list'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.principal.userId).toBe('alice')
  })

  it('accepts a token from ?access_token query parameter', async () => {
    const svc = await makeService()
    const token = await mintToken('bob')
    const result = await svc.authenticateRequest(makeReq({}, `/api/events/mux?access_token=${token}`))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.principal.userId).toBe('bob')
  })

  it('returns missing-token when neither header nor query carries a token', async () => {
    const svc = await makeService()
    const result = await svc.authenticateRequest(makeReq({}, '/api/session.list'))
    expect(result).toMatchObject({ ok: false, reason: 'missing-token' })
  })

  it('returns invalid-token for a tampered token', async () => {
    const svc = await makeService()
    const result = await svc.authenticateRequest(makeReq({ authorization: 'Bearer bad.token.here' }, '/api/session.list'))
    expect(result).toMatchObject({ ok: false, reason: 'invalid-token' })
  })
})
