/**
 * Shared login-UI config contract between the host half (publishes into HTML)
 * and the browser half (reads the HTML global). Keep this module free of Node
 * and Cordis host imports so the client bundle can import it safely.
 * @module @deepseek-ai/dsh-client-ui-auth/src/config
 */

/** Plugin configuration (cordis.yml → host → HTML global → browser half). */
export interface Config {
  /**
   * OAuth 2.0 authorization endpoint URL. Required when OAuth is the desired
   * login method. Omit to hide the OAuth button.
   */
  oauthAuthorizationEndpoint?: string
  /**
   * OAuth 2.0 token endpoint URL for PKCE authorization-code exchange.
   * Required together with {@link oauthAuthorizationEndpoint}.
   */
  oauthTokenEndpoint?: string
  /**
   * OAuth 2.0 public client id.
   */
  oauthClientId?: string
  /**
   * OAuth 2.0 redirect URI. Must match the IdP's registered callback.
   * Example: `http://127.0.0.1:3080/oauth/callback`.
   */
  oauthRedirectUri?: string
  /**
   * Space-separated OAuth scopes. Defaults to `openid profile` on the client.
   */
  oauthScopes?: string
  /**
   * Show a plain-text JWT paste field for local testing. Set to `true` only in
   * dev environments; never in production.
   */
  allowJwtPaste?: boolean
}

/** Global property the browser half reads for login options. */
export const AUTH_UI_CONFIG_GLOBAL = '__DSH_AUTH_UI_CONFIG__'
