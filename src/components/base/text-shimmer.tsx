import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

export function TextShimmer({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="text-shimmer"
      {...props}
      className={cx(
        'inline-block bg-linear-to-r from-text-primary via-text-secondary to-text-primary bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_2s_linear_infinite]',
        className,
      )}
    />
  )
}
