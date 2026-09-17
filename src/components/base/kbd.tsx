import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type KbdVariant = 'default' | 'light'

interface KbdProps extends ComponentProps<'kbd'> {
  variant?: KbdVariant
  slot?: string
}

function KbdRoot({ className, variant = 'default', ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      {...props}
      className={cn(
        'inline-flex items-center justify-center font-mono text-xs',
        variant === 'default' && 'h-5 min-w-5 rounded-md border border-border bg-surface-secondary px-1 text-muted',
        variant === 'light' && 'text-muted',
        className,
      )}
    />
  )
}

function KbdContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kbd-content" {...props} className={cn('', className)} />
}

export const Kbd = Object.assign(KbdRoot, { Content: KbdContent })
