/** Gateway-only injection of authenticated viewer identity into session/control opens. */

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function isPlainObject(value: object): value is Record<string, unknown> {
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null
}

function controlRequestFrom(payload: unknown): Record<string, unknown> {
  if (!isObject(payload) || !isPlainObject(payload) || !Object.hasOwn(payload, 'args')) return {}
  const args = payload.args
  if (!isObject(args) || !isPlainObject(args) || !Object.hasOwn(args, 'request')) return {}
  const request = args.request
  if (!isObject(request) || !isPlainObject(request)) return {}
  return { ...request }
}

/**
 * Stamp the authenticated viewer onto a Session control stream open payload.
 * @param payload - wire payload from the browser control stream open.
 * @param userId - authenticated principal user id from the WebSocket upgrade.
 * @returns payload whose `args.request` carries `viewerUserId` for Host-side filtering.
 */
export function injectControlViewerUserId(payload: unknown, userId: string): unknown {
  return { args: { request: { ...controlRequestFrom(payload), viewerUserId: userId } } }
}
