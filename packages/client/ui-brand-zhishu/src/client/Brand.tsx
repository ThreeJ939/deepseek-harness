import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Public static mark served by the web app. */
const ZHISHU_ICON_SRC = '/zhishu-icon.svg'

/** Product display name when `DSH_CLIENT_TITLE` is unset. */
const DEFAULT_PRODUCT_NAME = '智枢2.0'

/**
 * Resolve the product name shown beside the mark.
 * @returns build-time title when set, otherwise the Zhishu default.
 */
function productName(): string {
  return process.env.DSH_CLIENT_TITLE ?? DEFAULT_PRODUCT_NAME
}

/**
 * Render the Zhishu mark for the sidebar or hero.
 * @param props - Host-supplied mark presentation (`size` from either host; optional `className` from the hero).
 * @returns the product mark image.
 */
export function ZhishuBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return (
    <img
      src={ZHISHU_ICON_SRC}
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

/**
 * Render the Zhishu product name without its independently slotted mark.
 * @returns the product name text.
 */
export function ZhishuBrandName() {
  return <span>{productName()}</span>
}
