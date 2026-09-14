/**
 * Login gate plugin, browser half. Registers an `AuthGate` into the
 * `auth-gate` slot declared by `@deepseek-ai/dsh-client-ui-layout`.
 * @module @deepseek-ai/dsh-client-ui-auth/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: brings the auth-gate SlotMap merge into scope.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { AuthGate } from './AuthGate.tsx'
import { AUTH_UI_CONFIG_GLOBAL, type Config } from '../config.ts'
import { en, NS, zh, type AuthKey } from './locales.ts'

export type { AuthKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Multi-user login gate copy. */
    auth: AuthKey
  }
}

/** Required cordis services. */
export const inject = ['slots', 'locale']

/**
 * Read the host-injected login options from the boot HTML global.
 * @returns a safe Config object (never undefined).
 */
function readAuthUiConfig(): Config {
  const raw: unknown = Reflect.get(globalThis, AUTH_UI_CONFIG_GLOBAL)
  if (raw === null || typeof raw !== 'object') return { allowJwtPaste: false }
  return { ...raw }
}

/**
 * Browser plugin body: inject the auth gate into the layout's `auth-gate` slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-auth: dictionaries')
  const config = readAuthUiConfig()
  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    const Gate = (): ReturnType<typeof AuthGate> => AuthGate({ config, t })
    return ctx.slots.inject('auth-gate', () => {
      const dispose = ctx.slots.register({ name: 'auth-gate', locale: NS }, Gate)
      return () => { dispose() }
    })
  }, 'ui-auth: auth-gate registration')
}
