/**
 * Login form: OAuth 2.0 PKCE redirect and optional JWT paste (testing).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  FishLogo,
  IconLoadingOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Config } from '../config.ts'
import type { AuthKey } from './locales.ts'
import css from './LoginPage.module.css'

/** Storage key for the in-progress OAuth state verifier. */
const OAUTH_STATE_KEY = 'dsh.auth.oauth.state'
/** Storage key for the in-progress PKCE code verifier. */
const PKCE_VERIFIER_KEY = 'dsh.auth.pkce.verifier'

/** Props for {@link LoginPage}. */
export interface LoginPageProps {
  config: Config
  t: (key: AuthKey) => string
  onSuccess: (jwt: string) => void
}

function messageOf(error: unknown, t: (key: AuthKey) => string): string {
  if (error instanceof Error && error.message.startsWith('IdP token endpoint')) {
    return error.message
  }
  if (error instanceof Error && error.message.startsWith('/api/auth.exchange')) {
    return t('error.authExchange')
  }
  return error instanceof Error ? error.message : t('error.tokenExchange')
}

/**
 * OAuth PKCE redirect + optional JWT paste input.
 * @param props.config - plugin configuration forwarded from cordis.yml.
 * @param props.t - localized product copy.
 * @param props.onSuccess - called with the HS256 JWT once login succeeds.
 */
export function LoginPage({ config, t, onSuccess }: LoginPageProps) {
  const [pasteValue, setPasteValue] = useState('')
  const [pasteOpen, setPasteOpen] = useState(config.allowJwtPaste === true && (
    config.oauthAuthorizationEndpoint === undefined
    || config.oauthClientId === undefined
    || config.oauthRedirectUri === undefined
  ))
  const [error, setError] = useState<string | undefined>()
  const [exchanging, setExchanging] = useState(false)

  const hasOAuth = config.oauthAuthorizationEndpoint !== undefined
    && config.oauthClientId !== undefined
    && config.oauthRedirectUri !== undefined
  const showPasteToggle = hasOAuth && config.allowJwtPaste === true
  const showPasteForm = config.allowJwtPaste === true && (pasteOpen || !hasOAuth)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const code = params.get('code')
    const state = params.get('state')
    if (code === null || state === null) return

    const savedState = sessionStorage.getItem(OAUTH_STATE_KEY)
    const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY)
    if (savedState === null || codeVerifier === null || state !== savedState) {
      setError(t('error.oauthState'))
      return
    }
    sessionStorage.removeItem(OAUTH_STATE_KEY)
    sessionStorage.removeItem(PKCE_VERIFIER_KEY)

    const cleanUrl = new URL(location.href)
    cleanUrl.searchParams.delete('code')
    cleanUrl.searchParams.delete('state')
    history.replaceState(null, '', cleanUrl.toString())

    if (
      config.oauthTokenEndpoint === undefined
      || config.oauthClientId === undefined
      || config.oauthRedirectUri === undefined
    ) {
      setError(t('error.oauthTokenEndpoint'))
      return
    }

    setExchanging(true)
    exchangeCodeForJwt(
      code,
      codeVerifier,
      config.oauthTokenEndpoint,
      config.oauthClientId,
      config.oauthRedirectUri,
      t,
    ).then(onSuccess).catch((err: unknown) => {
      setError(messageOf(err, t))
      setExchanging(false)
    })
  }, [])

  const handleOAuthClick = useCallback(async () => {
    if (
      config.oauthAuthorizationEndpoint === undefined
      || config.oauthClientId === undefined
      || config.oauthRedirectUri === undefined
    ) {
      setError(t('error.oauthIncomplete'))
      return
    }
    setError(undefined)
    try {
      const { url, state, codeVerifier } = await buildAuthorizationUrl(
        config.oauthAuthorizationEndpoint,
        config.oauthClientId,
        config.oauthRedirectUri,
        config.oauthScopes ?? 'openid profile',
      )
      sessionStorage.setItem(OAUTH_STATE_KEY, state)
      sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier)
      location.assign(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.oauthStart'))
    }
  }, [config, t])

  const handlePasteSubmit = useCallback(() => {
    const trimmed = pasteValue.trim()
    if (trimmed.length === 0) {
      setError(t('error.jwtEmpty'))
      return
    }
    setError(undefined)
    onSuccess(trimmed)
  }, [pasteValue, onSuccess, t])

  return (
    <div className={css.shell}>
      <div className={css.hero}>
        <FishLogo size={40} className={css.logo} />
      </div>
      <h2 className={css.title}>{t('modal.title')}</h2>
      <p className={css.description}>{t('modal.description')}</p>

      {exchanging ? (
        <div className={css.loading} role="status">
          <IconLoadingOutline16 size={16} className={css.spinner} aria-hidden="true" />
          <span>{t('signingIn')}</span>
        </div>
      ) : (
        <div className={css.actions}>
          {error !== undefined && <div className={css.errorBanner} role="alert">{error}</div>}

          {hasOAuth && (
            <Button
              variant="primary"
              className={css.fullWidth}
              onClick={() => { void handleOAuthClick() }}
            >
              {t('oauthContinue')}
            </Button>
          )}

          {showPasteToggle && showPasteForm && (
            <div className={css.divider}>{t('divider')}</div>
          )}

          {showPasteToggle && (
            <button
              type="button"
              className={css.pasteToggle}
              onClick={() => { setPasteOpen(open => !open) }}
            >
              {pasteOpen ? t('pasteToggleHide') : t('pasteToggle')}
            </button>
          )}

          {showPasteForm && (
            <div className={css.pasteSection}>
              <label className={css.label} htmlFor="jwt-paste">
                {t('pasteLabel')}
              </label>
              <textarea
                id="jwt-paste"
                className={css.textarea}
                value={pasteValue}
                onChange={(e) => { setPasteValue(e.target.value) }}
                placeholder={t('pastePlaceholder')}
                spellCheck={false}
              />
              <Button
                variant="outline"
                className={css.fullWidth}
                disabled={pasteValue.trim().length === 0}
                onClick={handlePasteSubmit}
              >
                {t('pasteSubmit')}
              </Button>
            </div>
          )}

          {!hasOAuth && config.allowJwtPaste !== true && (
            <p className={css.empty}>{t('error.noMethod')}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Build an OAuth 2.0 PKCE authorization URL. */
async function buildAuthorizationUrl(
  authorizationEndpoint: string,
  clientId: string,
  redirectUri: string,
  scopes: string,
): Promise<{ url: string; state: string; codeVerifier: string }> {
  const state = generateRandomString(32)
  const codeVerifier = generateRandomString(64)
  const codeChallenge = await sha256Base64Url(codeVerifier)
  const url = new URL(authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scopes)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return { url: url.toString(), state, codeVerifier }
}

/**
 * Exchange an authorization code (with PKCE verifier) for a dsh JWT.
 */
async function exchangeCodeForJwt(
  code: string,
  codeVerifier: string,
  tokenEndpoint: string,
  clientId: string,
  redirectUri: string,
  t: (key: AuthKey) => string,
): Promise<string> {
  const tokenRes = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  })
  if (!tokenRes.ok) {
    throw new Error(`IdP token endpoint returned ${tokenRes.status}`)
  }
  const tokenData = await tokenRes.json() as { access_token?: string }
  const idpToken = tokenData.access_token
  if (typeof idpToken !== 'string' || idpToken.length === 0) {
    throw new Error(t('error.idpToken'))
  }

  const exchangeRes = await fetch('/api/auth.exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idpToken }),
  })
  if (!exchangeRes.ok) {
    throw new Error(`/api/auth.exchange returned ${exchangeRes.status}`)
  }
  const exchangeData = await exchangeRes.json() as { jwt?: string }
  const jwt = exchangeData.jwt
  if (typeof jwt !== 'string' || jwt.length === 0) {
    throw new Error(t('error.authExchangeJwt'))
  }
  return jwt
}

/** Generate a cryptographically random URL-safe string of `length` characters. */
function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    .slice(0, length)
}

/** SHA-256 hash of `input` encoded as base64url. */
async function sha256Base64Url(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashBytes = new Uint8Array(hashBuffer)
  return btoa(String.fromCharCode(...hashBytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
