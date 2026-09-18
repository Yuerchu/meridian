import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface ItemCardProps extends ComponentProps<'div'> {
  variant?: string
  onClick?: () => void
}

function ItemCardRoot({ className, variant: _variant, onClick, ...props }: ItemCardProps) {
  return (
    <div
      data-slot="item-card"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick()
            }
          : undefined
      }
      {...props}
      className={cx(
        'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
        onClick && 'cursor-[var(--cursor-interactive)] hover:bg-background-secondary-default',
        className,
      )}
    />
  )
}

function ItemCardIcon({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-card-icon"
      {...props}
      className={cx('flex shrink-0 items-center text-text-secondary', className)}
    />
  )
}

function ItemCardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="item-card-content" {...props} className={cx('flex min-w-0 flex-1 flex-col gap-0.5', className)} />
  )
}

function ItemCardTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="item-card-title" {...props} className={cx('truncate font-medium', className)} />
}

function ItemCardDescription({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="item-card-description"
      {...props}
      className={cx('truncate text-xs text-text-secondary', className)}
    />
  )
}

function ItemCardAction({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="item-card-action" {...props} className={cx('flex shrink-0 items-center', className)} />
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
      className={cx(
        'divide-y divide-separator-border overflow-hidden rounded-lg border border-border-button-default bg-background-primary-default shadow-xs',
        className,
      )}
    />
  )
}

function ItemCardGroupHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="item-card-group-header" {...props} className={cx('flex items-center gap-2 px-3 py-2', className)} />
  )
}

function ItemCardGroupTitle({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="item-card-group-title"
      {...props}
      className={cx('text-xs font-medium text-text-secondary', className)}
    />
  )
}

export const ItemCardGroup = Object.assign(ItemCardGroupRoot, {
  Header: ItemCardGroupHeader,
  Title: ItemCardGroupTitle,
})
