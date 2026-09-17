import type { ComponentProps, ReactElement } from 'react'
import { cn } from '@/lib/utils'

interface SkeletonProps extends ComponentProps<'div'> {
  render?: (props: ComponentProps<'div'>) => ReactElement
}

export function Skeleton({ className, render, ...props }: SkeletonProps) {
  const skeletonClass = cn(
    'pointer-events-none relative overflow-hidden rounded-sm bg-surface-tertiary/70',
    'after:absolute after:inset-0 after:-translate-x-full after:animate-skeleton after:bg-linear-to-r after:from-transparent after:via-surface-tertiary after:to-transparent after:content-[""]',
    className,
  )
  if (render) return render({ ...props, className: skeletonClass })
  return <div aria-busy data-slot="skeleton" role="status" {...props} className={skeletonClass} />
}
