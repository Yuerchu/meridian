import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface ItemCardProps extends ComponentProps<'div'> {
  variant?: string
  onPress?: () => void
}

function ItemCardRoot({ className, variant: _variant, onPress, ...props }: ItemCardProps) {
  return (
    <div
      data-slot="item-card"
      role={onPress ? 'button' : undefined}
      tabIndex={onPress ? 0 : undefined}
      onClick={onPress}
      onKeyDown={
        onPress
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onPress()
            }
          : undefined
      }
      {...props}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
        onPress && 'cursor-[var(--cursor-interactive)] hover:bg-default',
        className,
      )}
    />
  )
}

function ItemCardIcon({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="item-card-icon" {...props} className={cn('flex shrink-0 items-center text-muted', className)} />
  )
}

function ItemCardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="item-card-content" {...props} className={cn('flex min-w-0 flex-1 flex-col gap-0.5', className)} />
  )
}

function ItemCardTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="item-card-title" {...props} className={cn('truncate font-medium', className)} />
}

function ItemCardDescription({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="item-card-description" {...props} className={cn('truncate text-xs text-muted', className)} />
}

function ItemCardAction({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="item-card-action" {...props} className={cn('flex shrink-0 items-center', className)} />
}

export const ItemCard = Object.assign(ItemCardRoot, {
  Icon: ItemCardIcon,
  Content: ItemCardContent,
  Title: ItemCardTitle,
  Description: ItemCardDescription,
  Action: ItemCardAction,
})

function ItemCardGroupRoot({ className, variant: _variant, ...props }: ComponentProps<'div'> & { variant?: string }) {
  return (
    <div
      data-slot="item-card-group"
      {...props}
      className={cn(
        'divide-y divide-separator overflow-hidden rounded-lg border border-border bg-surface shadow-surface',
        className,
      )}
    />
  )
}

function ItemCardGroupHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="item-card-group-header" {...props} className={cn('flex items-center gap-2 px-3 py-2', className)} />
  )
}

function ItemCardGroupTitle({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="item-card-group-title" {...props} className={cn('text-xs font-medium text-muted', className)} />
  )
}

export const ItemCardGroup = Object.assign(ItemCardGroupRoot, {
  Header: ItemCardGroupHeader,
  Title: ItemCardGroupTitle,
})
