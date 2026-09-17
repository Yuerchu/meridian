import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function TextShimmer({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="text-shimmer"
      {...props}
      className={cn(
        'inline-block bg-linear-to-r from-foreground via-muted to-foreground bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_2s_linear_infinite]',
        className,
      )}
    />
  )
}
