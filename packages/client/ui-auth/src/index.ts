/**
 * Multi-user login UI plugin, host half. Validates cordis.yml Config and
 * publishes it into the boot HTML as `globalThis.__DSH_AUTH_UI_CONFIG__` so the
 * browser half can read it — client Loader entries are created as `{ name }`
 * only and do not receive host config.
 * @module @deepseek-ai/dsh-client-ui-auth
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { AUTH_UI_CONFIG_GLOBAL, type Config as AuthUiConfig } from './config.ts'

export { AUTH_UI_CONFIG_GLOBAL } from './config.ts'

/** Cordis Config schema (Loader looks up the export named `Config`). */
export const Config: z<AuthUiConfig> = z.object({
  oauthAuthorizationEndpoint: z.string().default(''),
  oauthTokenEndpoint: z.string().default(''),
  oauthClientId: z.string().default(''),
  oauthRedirectUri: z.string().default(''),
  oauthScopes: z.string().default(''),
  allowJwtPaste: z.boolean().default(false),
})

/**
 * Strip empty optional strings so the client can treat absence as "not configured".
 * @param config - validated plugin config.
 * @returns JSON-serializable config for the HTML global.
 */
function publishableConfig(config: AuthUiConfig): AuthUiConfig {
  const out: AuthUiConfig = { allowJwtPaste: config.allowJwtPaste === true }
  if (config.oauthAuthorizationEndpoint !== undefined && config.oauthAuthorizationEndpoint.length > 0) {
    out.oauthAuthorizationEndpoint = config.oauthAuthorizationEndpoint
  }
  if (config.oauthTokenEndpoint !== undefined && config.oauthTokenEndpoint.length > 0) {
    out.oauthTokenEndpoint = config.oauthTokenEndpoint
  }
  if (config.oauthClientId !== undefined && config.oauthClientId.length > 0) {
    out.oauthClientId = config.oauthClientId
  }
  if (config.oauthRedirectUri !== undefined && config.oauthRedirectUri.length > 0) {
    out.oauthRedirectUri = config.oauthRedirectUri
  }
  if (config.oauthScopes !== undefined && config.oauthScopes.length > 0) {
    out.oauthScopes = config.oauthScopes
  }
  return out
}

/**
 * Publish login options into the index HTML for the browser half.
 * @param ctx - host Cordis context.
 * @param config - validated plugin config from cordis.yml.
 */
export function apply(ctx: Context, config: AuthUiConfig): void {
  const published = publishableConfig(config)
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: AUTH_UI_CONFIG_GLOBAL, value: published })
    }), 'ui-auth: publish login config')
  })
}
