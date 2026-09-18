import type { ComponentProps, HTMLAttributes, Ref } from 'react'
import { cx } from '@/utils/cx'

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  ref?: Ref<HTMLElement>
  variant?: 'default' | 'light'
}

function KbdRoot({ className, variant = 'default', ref, ...props }: KbdProps) {
  return (
    <kbd
      ref={ref}
      data-slot="kbd"
      className={cx(
        'inline-flex items-center justify-center rounded-full font-sans text-caption-1-semibold tracking-normal whitespace-nowrap',
        variant === 'default' && 'bg-kbd-background px-1 py-0.5 text-kbd-foreground',
        variant === 'light' && 'text-kbd-foreground',
        className,
      )}
      {...props}
    />
  )
}

function KbdContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kbd-content" {...props} className={cx('', className)} />
}

export const Kbd = Object.assign(KbdRoot, { Content: KbdContent })
