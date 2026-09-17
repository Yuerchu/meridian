import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-busy
      data-slot="skeleton"
      role="status"
      {...props}
      className={cn(
        'pointer-events-none relative overflow-hidden rounded-sm bg-surface-tertiary/70',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-skeleton after:bg-linear-to-r after:from-transparent after:via-surface-tertiary after:to-transparent after:content-[""]',
        className,
      )}
    />
  )
}
