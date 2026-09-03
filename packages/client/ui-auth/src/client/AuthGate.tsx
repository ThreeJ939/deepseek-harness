/**
 * Mandatory login gate: a non-dismissible modal over the blurred app shell.
 */
import { useEffect, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoginPage } from './LoginPage.tsx'
import type { Config } from '../config.ts'
import {
  AUTH_EXPIRY_CHECK_INTERVAL_MS,
  DSH_AUTH_EXPIRED_EVENT,
  DSH_AUTH_JWT_KEY,
  clearStoredAuthJwt,
  isAuthJwtExpired,
  notifyAuthExpired,
  readStoredAuthJwt,
} from './auth-session.ts'
import type { AuthKey } from './locales.ts'
import css from './AuthGate.module.css'

/** Props for {@link AuthGate}. */
export interface AuthGateProps {
  config: Config
  /** Locale-bound copy for the gate and login form. */
  t: (key: AuthKey) => string
}

function initialHasToken(): boolean {
  const jwt = readStoredAuthJwt()
  if (jwt === undefined) return false
  if (isAuthJwtExpired(jwt)) {
    clearStoredAuthJwt()
    return false
  }
  return true
}

/**
 * Renders a mandatory login modal while the page has no JWT.
 * @param props.config - login options from the host-injected HTML global.
 * @param props.t - localized product copy.
 */
export function AuthGate({ config, t }: AuthGateProps) {
  const [hasToken, setHasToken] = useState(initialHasToken)
  const open = !hasToken

  useEffect(() => {
    const onExpired = (): void => { setHasToken(false) }
    globalThis.addEventListener(DSH_AUTH_EXPIRED_EVENT, onExpired)

    const checkExpiry = (): void => {
      const jwt = readStoredAuthJwt()
      if (jwt !== undefined && isAuthJwtExpired(jwt)) notifyAuthExpired()
    }
    checkExpiry()
    const interval = setInterval(checkExpiry, AUTH_EXPIRY_CHECK_INTERVAL_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') checkExpiry()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      globalThis.removeEventListener(DSH_AUTH_EXPIRED_EVENT, onExpired)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    appRoot.inert = true
    return () => { appRoot.inert = false }
  }, [open])

  if (!open) return null

  return (
    <Modal
      open
      headless
      dismissible={false}
      onClose={() => {}}
      title={t('modal.title')}
      className={css.loginModal}
    >
      <LoginPage
        config={config}
        t={t}
        onSuccess={(jwt) => {
          sessionStorage.setItem(DSH_AUTH_JWT_KEY, jwt)
          setHasToken(true)
          location.reload()
        }}
      />
    </Modal>
  )
}
