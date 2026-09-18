import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface ScrollShadowProps extends ComponentProps<'div'> {
  orientation?: 'horizontal' | 'vertical'
  hideScrollBar?: boolean
}

export function ScrollShadow({
  className,
  orientation: _orientation,
  hideScrollBar: _hsb,
  ...props
}: ScrollShadowProps) {
  return <div data-slot="scroll-shadow" {...props} className={cx('overflow-auto', className)} />
}
