/**
 * Browser JWT session helpers for the login gate.
 * Must stay aligned with `@deepseek-ai/dsh-client-connection` `auth-storage-key.ts`.
 */

/** sessionStorage key for the dsh HS256 JWT. */
export const DSH_AUTH_JWT_KEY = 'dsh.auth.jwt'

/** Document event {@link notifyAuthExpired} dispatches so login UI can reopen. */
export const DSH_AUTH_EXPIRED_EVENT = 'dsh-auth-expired'

const EXPIRY_CHECK_INTERVAL_MS = 15_000

/** Poll interval for client-side JWT expiry checks in {@link AuthGate}. */
export const AUTH_EXPIRY_CHECK_INTERVAL_MS = EXPIRY_CHECK_INTERVAL_MS

/**
 * Read the stored JWT when sessionStorage is available.
 * @returns the token string, or undefined when absent or unreadable.
 */
export function readStoredAuthJwt(): string | undefined {
  try {
    const value = globalThis.sessionStorage?.getItem(DSH_AUTH_JWT_KEY)
    return value === null || value === undefined || value.length === 0 ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * Remove the stored JWT without notifying listeners.
 */
export function clearStoredAuthJwt(): void {
  try {
    globalThis.sessionStorage?.removeItem(DSH_AUTH_JWT_KEY)
  } catch {
    // sessionStorage may throw in opaque/sandboxed origins.
  }
}

/**
 * Whether a JWT payload's `exp` is in the past.
 * @param jwt - HS256 JWT string.
 * @param skewSeconds - optional seconds before expiry treated as expired.
 * @returns true when `exp` is present and elapsed; false when absent or unreadable.
 */
export function isAuthJwtExpired(jwt: string, skewSeconds = 0): boolean {
  const exp = decodeJwtExp(jwt)
  if (exp === undefined) return false
  return Math.floor(Date.now() / 1000) >= exp - skewSeconds
}

/**
 * Clear a stored JWT and dispatch {@link DSH_AUTH_EXPIRED_EVENT} when one was present.
 */
export function notifyAuthExpired(): void {
  if (readStoredAuthJwt() === undefined) return
  clearStoredAuthJwt()
  try {
    globalThis.dispatchEvent?.(new Event(DSH_AUTH_EXPIRED_EVENT))
  } catch {
    // dispatchEvent may be absent in non-browser runtimes.
  }
}

function decodeJwtExp(jwt: string): number | undefined {
  const segments = jwt.split('.')
  if (segments.length !== 3) return undefined
  const payloadSegment = segments[1]
  if (payloadSegment === undefined || payloadSegment.length === 0) return undefined
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
    const payload = JSON.parse(atob(padded)) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp : undefined
  } catch {
    return undefined
  }
}
