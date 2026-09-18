import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

/**
 * A scroll container whose edges fade, so a row that continues off-screen
 * says so. The fade is a mask on the container, which costs nothing per
 * frame; the scrollbar can be hidden where the fade already says "more".
 */
export interface ScrollShadowProps extends ComponentProps<'div'> {
  orientation?: 'horizontal' | 'vertical'
  hideScrollBar?: boolean
}

export function ScrollShadow({
  className,
  orientation = 'vertical',
  hideScrollBar = false,
  ...props
}: ScrollShadowProps) {
  return (
    <div
      data-slot="scroll-shadow"
      data-orientation={orientation}
      {...props}
      className={cx(
        orientation === 'horizontal'
          ? 'overflow-x-auto overflow-y-hidden [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)]'
          : 'overflow-y-auto overflow-x-hidden [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]',
        hideScrollBar && '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    />
  )
}
