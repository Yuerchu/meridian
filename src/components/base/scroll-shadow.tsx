import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

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
  return <div data-slot="scroll-shadow" {...props} className={cn('overflow-auto', className)} />
}
