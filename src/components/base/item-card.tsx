import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

/**
 * A row with an icon, a title, a description and something at its end; a
 * group of them is one surface with hairlines between the rows (Settings →
 * About). `variant="outline"` is the bordered card; `transparent` keeps only
 * the rows and their dividers.
 */

type ItemCardVariant = 'outline' | 'transparent'

interface ItemCardProps extends ComponentProps<'div'> {
  variant?: ItemCardVariant
}

function ItemCardRoot({ className, variant = 'transparent', ...props }: ItemCardProps) {
  return (
    <div
      data-slot="item-card"
      data-variant={variant}
      {...props}
      className={cx(
        'flex items-center gap-3 px-3 py-2.5 text-body-regular',
        variant === 'outline' &&
          'rounded-xl border border-border-button-default bg-background-primary-default shadow-xs',
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
      className={cx('flex shrink-0 items-center text-foreground-icon-secondary [&_svg]:size-5', className)}
    />
  )
}

function ItemCardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="item-card-content" {...props} className={cx('flex min-w-0 flex-1 flex-col gap-0.5', className)} />
  )
}

function ItemCardTitle({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="item-card-title"
      {...props}
      className={cx('truncate text-body-medium text-text-primary', className)}
    />
  )
}

function ItemCardDescription({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="item-card-description"
      {...props}
      className={cx('truncate text-caption-1-medium text-text-secondary', className)}
    />
  )
}

function ItemCardAction({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="item-card-action" {...props} className={cx('flex shrink-0 items-center gap-1', className)} />
}

export const ItemCard = Object.assign(ItemCardRoot, {
  Icon: ItemCardIcon,
  Content: ItemCardContent,
  Title: ItemCardTitle,
  Description: ItemCardDescription,
  Action: ItemCardAction,
})

interface ItemCardGroupProps extends ComponentProps<'div'> {
  variant?: ItemCardVariant
}

function ItemCardGroupRoot({ className, variant = 'outline', ...props }: ItemCardGroupProps) {
  return (
    <div
      data-slot="item-card-group"
      data-variant={variant}
      {...props}
      className={cx(
        'divide-y divide-border-button-default overflow-hidden',
        variant === 'outline' &&
          'rounded-2xl border border-border-button-default bg-background-primary-default shadow-xs',
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
      className={cx('text-caption-1-medium text-text-secondary', className)}
    />
  )
}

export const ItemCardGroup = Object.assign(ItemCardGroupRoot, {
  Header: ItemCardGroupHeader,
  Title: ItemCardGroupTitle,
})
