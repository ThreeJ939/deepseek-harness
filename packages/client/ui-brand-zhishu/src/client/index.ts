/** Zhishu brand occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ZhishuBrandMark, ZhishuBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar and hero brand slots as one declaration-aware registration
 * set. Unlike the official package, this deployment always registers when the
 * plugin is mounted — white-label identity does not wait on
 * `DSH_CLIENT_BUILD_PROFILE=official`.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, ZhishuBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, ZhishuBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, ZhishuBrandMark)
      })))
}
