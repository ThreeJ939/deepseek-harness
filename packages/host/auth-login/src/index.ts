/**
 * @deepseek-ai/dsh-host-auth-login — token-exchange endpoint for multi-user
 * dsh deployments. Registers `POST /api/auth.exchange`, which accepts an IdP
 * access token, calls the configured SaaS userinfo endpoint to extract the
 * user's `sub`, and returns a short-lived HS256 JWT the browser can carry as a
 * Bearer token on subsequent `/api` calls.
 *
 * This package is intentionally host-only and carries no client bundle: the
 * browser side of the login flow lives in `@deepseek-ai/dsh-client-ui-auth`.
 * @module @deepseek-ai/dsh-host-auth-login
 */

import { createSecretKey, type KeyObject } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SignJWT } from 'jose'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Plugin configuration. */
export interface Config {
  /**
   * SaaS userinfo endpoint URL, e.g. `https://saas.example/userinfo`. The
   * endpoint must accept `Authorization: Bearer <idpToken>` and return a JSON
   * object with a `sub` field.
   * Read from `DSH_SAAS_USERINFO_URL` when not set explicitly.
   */
  saasUserinfoUrl?: string
  /**
   * HMAC-SHA256 secret for signing the issued JWT. Must match the secret
   * configured in `dsh-host-auth-middleware`. Read from `DSH_JWT_SECRET` when
   * not set explicitly.
   */
  jwtSecret?: string
  /**
   * Issued JWT lifetime in seconds. Defaults to 3600 (one hour).
   */
  jwtTtlSeconds?: number
}

/**
 * The auth-login Cordis service. Registers `POST /api/auth.exchange`.
 */
export class AuthLoginService extends Service {
  static inject = ['webServer']

  static Config: z<Config> = z.object({
    // Optional: !!js process.env.* may be undefined; init() fails loud when missing.
    saasUserinfoUrl: z.string().default(''),
    jwtSecret: z.string().default(''),
    jwtTtlSeconds: z.natural().default(3600),
  })

  private readonly config: Config
  private secretKey!: KeyObject

  constructor(ctx: Context, config: Config) {
    super(ctx, 'authLogin')
    this.config = config
  }

  async [Service.init](): Promise<void> {
    const secret = this.config.jwtSecret ?? process.env['DSH_JWT_SECRET']
    if (secret === undefined || secret.length < 32) {
      throw new Error(
        'auth-login: jwtSecret must be at least 32 characters '
        + '(set via config.jwtSecret or the DSH_JWT_SECRET environment variable)',
      )
    }
    this.secretKey = createSecretKey(Buffer.from(secret, 'utf8'))

    const saasUserinfoUrl = this.config.saasUserinfoUrl ?? process.env['DSH_SAAS_USERINFO_URL']
    if (saasUserinfoUrl === undefined || saasUserinfoUrl.length === 0) {
      throw new Error(
        'auth-login: saasUserinfoUrl must be set '
        + '(set via config.saasUserinfoUrl or the DSH_SAAS_USERINFO_URL environment variable)',
      )
    }

    const route: WebRoute = {
      kind: 'exact',
      path: '/api/auth.exchange',
      handler: (req, res) => this.handleExchange(req, res, saasUserinfoUrl),
    }
    this.ctx.effect(
      () => this.ctx.webServer.register(route),
      'authLogin: POST /api/auth.exchange route',
    )
  }

  /**
   * Handle `POST /api/auth.exchange`.
   *
   * Request body: `{ "idpToken": "<access_token from IdP>" }`
   * Response: `{ "jwt": "<HS256 JWT>", "expiresAt": <Unix timestamp> }`
   */
  private async handleExchange(
    req: IncomingMessage,
    res: ServerResponse,
    saasUserinfoUrl: string,
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json', 'allow': 'POST' })
      res.end(JSON.stringify({ error: 'method_not_allowed', message: 'Only POST is accepted' }))
      return
    }

    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad_request', message: 'Request body must be valid JSON' }))
      return
    }

    if (
      body === null
      || typeof body !== 'object'
      || !('idpToken' in body)
      || typeof (body as Record<string, unknown>)['idpToken'] !== 'string'
      || ((body as Record<string, unknown>)['idpToken'] as string).length === 0
    ) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad_request', message: 'Missing or empty idpToken field' }))
      return
    }

    const idpToken = (body as { idpToken: string }).idpToken

    let sub: string
    try {
      sub = await this.fetchUserSub(idpToken, saasUserinfoUrl)
    } catch (error) {
      const message = error instanceof UserInfoError ? error.message : 'IdP userinfo call failed'
      const status = error instanceof UserInfoError ? error.status : 502
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'upstream_error', message }))
      return
    }

    const ttlSeconds = this.config.jwtTtlSeconds ?? 3600
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + ttlSeconds

    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .sign(this.secretKey)

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jwt, expiresAt }))
  }

  /**
   * Call the SaaS userinfo endpoint and return the `sub` claim.
   * @param idpToken - IdP access token presented by the browser.
   * @param userInfoUrl - configured userinfo endpoint.
   * @returns the verified user subject string.
   * @throws {UserInfoError} when the endpoint rejects or returns no `sub`.
   */
  private async fetchUserSub(idpToken: string, userInfoUrl: string): Promise<string> {
    let response: Response
    try {
      response = await fetch(userInfoUrl, {
        headers: { authorization: `Bearer ${idpToken}` },
      })
    } catch (error) {
      throw new UserInfoError(502, `userinfo fetch failed: ${String(error)}`)
    }
    if (!response.ok) {
      throw new UserInfoError(
        response.status >= 400 && response.status < 500 ? 401 : 502,
        `userinfo endpoint returned ${response.status}`,
      )
    }
    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new UserInfoError(502, 'userinfo response is not valid JSON')
    }
    if (
      data === null
      || typeof data !== 'object'
      || !('sub' in data)
      || typeof (data as Record<string, unknown>)['sub'] !== 'string'
      || ((data as Record<string, unknown>)['sub'] as string).length === 0
    ) {
      throw new UserInfoError(502, 'userinfo response missing or empty sub field')
    }
    return (data as { sub: string }).sub
  }
}

/** Typed error for userinfo fetch failures. */
class UserInfoError extends Error {
  constructor(
    /** HTTP status to forward to the client. */
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'UserInfoError'
  }
}

/**
 * Read and JSON-parse an HTTP request body.
 * @param req - incoming HTTP request.
 * @returns parsed JSON value.
 * @throws when the body is not valid JSON.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array))
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length === 0 ? undefined : JSON.parse(raw)
}

export default AuthLoginService
