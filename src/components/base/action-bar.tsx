import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface ActionBarProps extends ComponentProps<'div'> {
  isOpen?: boolean
}

function ActionBarRoot({ className, isOpen, ...props }: ActionBarProps) {
  if (!isOpen) return null
  return (
    <div
      data-slot="action-bar"
      {...props}
      className={cn(
        'fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit items-center gap-2 rounded-xl border border-border bg-overlay px-3 py-2 shadow-overlay',
        'animate-in fade-in-0 slide-in-from-bottom-2 duration-200',
        className,
      )}
    />
  )
}

function ActionBarPrefix({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="action-bar-prefix" {...props} className={cn('text-sm text-muted', className)} />
}

function ActionBarContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="action-bar-content" {...props} className={cn('flex items-center gap-1', className)} />
}

function ActionBarSuffix({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="action-bar-suffix" {...props} className={cn('flex items-center gap-1', className)} />
}

export const ActionBar = Object.assign(ActionBarRoot, {
  Prefix: ActionBarPrefix,
  Content: ActionBarContent,
  Suffix: ActionBarSuffix,
})
