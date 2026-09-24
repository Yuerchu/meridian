import type { ComponentProps, ReactElement } from 'react'
import { cx } from '@/utils/cx'

interface SkeletonProps extends ComponentProps<'div'> {
  render?: (props: ComponentProps<'div'>) => ReactElement
}

export function Skeleton({ className, render, ...props }: SkeletonProps) {
  const skeletonClass = cx(
    'pointer-events-none relative overflow-hidden rounded-sm bg-background-tertiary-default/70',
    'after:absolute after:inset-0 after:-translate-x-full after:animate-skeleton after:bg-linear-to-r after:from-transparent after:via-background-tertiary-default after:to-transparent after:content-[""]',
    'motion-reduce:after:animate-none',
    className,
  )
  if (render) return render({ ...props, className: skeletonClass })
  return <div aria-busy data-slot="skeleton" role="status" {...props} className={skeletonClass} />
}
