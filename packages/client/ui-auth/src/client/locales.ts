/** Locale namespace owned by the multi-user login gate. */
export const NS = 'auth'

/** Simplified-Chinese login strings. */
export const zh = {
  'modal.title': '登录 DeepSeek',
  'modal.description': '登录后即可使用会话、模型与设置等功能。',
  'signingIn': '正在登录…',
  'oauthContinue': '使用 OAuth 登录',
  'divider': '或',
  'pasteToggle': '开发者：粘贴 JWT',
  'pasteToggleHide': '收起 JWT 输入',
  'pasteLabel': 'JWT 令牌',
  'pastePlaceholder': '粘贴 eyJ… 开头的令牌',
  'pasteSubmit': '使用此令牌',
  'error.oauthState': 'OAuth 状态不匹配，请重试。',
  'error.oauthTokenEndpoint': 'OAuth 令牌端点未配置。',
  'error.oauthIncomplete': 'OAuth 未完整配置。',
  'error.oauthStart': '无法启动 OAuth 流程。',
  'error.jwtEmpty': 'JWT 不能为空。',
  'error.noMethod': '未配置登录方式。',
  'error.tokenExchange': '令牌交换失败。',
  'error.idpToken': '身份提供方未返回 access_token。',
  'error.authExchange': '登录交换失败。',
  'error.authExchangeJwt': '登录交换未返回 JWT。',
} as const

/** English login strings. */
export const en: Record<keyof typeof zh, string> = {
  'modal.title': 'Sign in to DeepSeek',
  'modal.description': 'Sign in to use sessions, models, settings, and other features.',
  'signingIn': 'Signing you in…',
  'oauthContinue': 'Sign in with OAuth',
  'divider': 'or',
  'pasteToggle': 'Developer: paste JWT',
  'pasteToggleHide': 'Hide JWT input',
  'pasteLabel': 'JWT token',
  'pastePlaceholder': 'Paste a token starting with eyJ…',
  'pasteSubmit': 'Use this token',
  'error.oauthState': 'OAuth state mismatch — please try again.',
  'error.oauthTokenEndpoint': 'OAuth token endpoint is not configured.',
  'error.oauthIncomplete': 'OAuth is not fully configured.',
  'error.oauthStart': 'Failed to start OAuth flow.',
  'error.jwtEmpty': 'JWT must not be empty.',
  'error.noMethod': 'No login method is configured.',
  'error.tokenExchange': 'Token exchange failed.',
  'error.idpToken': 'IdP did not return an access_token.',
  'error.authExchange': 'Login exchange failed.',
  'error.authExchangeJwt': 'Login exchange did not return a jwt.',
}

/** Stable locale keys for the login gate. */
export type AuthKey = keyof typeof zh
