import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type EmptyStateSize = 'sm' | 'md' | 'lg'

interface EmptyStateProps extends ComponentProps<'div'> {
  size?: EmptyStateSize
}

function EmptyStateRoot({ size = 'md', className, ...props }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      {...props}
      className={cn(
        'flex flex-col items-center justify-center gap-2 p-6 text-center text-muted',
        size === 'sm' && 'gap-1 p-2 text-sm',
        size === 'lg' && 'gap-3 p-8',
        className,
      )}
    />
  )
}

function EmptyStateHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="empty-state-header" {...props} className={cn('flex flex-col items-center gap-1', className)} />
}

function EmptyStateTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3 data-slot="empty-state-title" {...props} className={cn('text-sm font-medium text-foreground', className)} />
  )
}

function EmptyStateDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="empty-state-description" {...props} className={cn('text-sm text-muted', className)} />
}

function EmptyStateContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="empty-state-content" {...props} className={cn('flex flex-col items-center gap-2', className)} />
  )
}

interface EmptyStateMediaProps extends ComponentProps<'div'> {
  variant?: 'icon' | 'image'
}

function EmptyStateMedia({ className, variant: _variant, ...props }: EmptyStateMediaProps) {
  return <div data-slot="empty-state-media" {...props} className={cn('flex items-center justify-center', className)} />
}

export const EmptyState = Object.assign(EmptyStateRoot, {
  Header: EmptyStateHeader,
  Title: EmptyStateTitle,
  Description: EmptyStateDescription,
  Content: EmptyStateContent,
  Media: EmptyStateMedia,
})
