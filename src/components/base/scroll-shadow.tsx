import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface ScrollShadowProps extends ComponentProps<'div'> {
  orientation?: 'horizontal' | 'vertical'
}

export function ScrollShadow({ className, orientation: _orientation, ...props }: ScrollShadowProps) {
  return <div data-slot="scroll-shadow" {...props} className={cn('overflow-auto', className)} />
}
