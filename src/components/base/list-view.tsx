import { ListBox, ListBoxItem, type ListBoxProps, type ListBoxItemProps } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface ListViewProps<T extends object> extends ListBoxProps<T> {
  /** `secondary` sits on the panel colour instead of a raised white card. */
  variant?: 'primary' | 'secondary'
}

function ListViewRoot<T extends object>({ className, variant = 'primary', ...props }: ListViewProps<T>) {
  return (
    <ListBox
      data-slot="list-view"
      data-variant={variant}
      {...props}
      className={cx(
        'flex flex-col overflow-hidden rounded-2xl border border-border-button-default',
        variant === 'primary' ? 'bg-background-primary-default' : 'bg-background-secondary-default',
        className as string,
      )}
    />
  )
}

function ListViewItem({ className, ...props }: ListBoxItemProps) {
  return (
    <ListBoxItem
      data-slot="list-view-item"
      {...props}
      className={cx(
        'flex items-center gap-3 border-b border-separator-border px-3 py-2.5 text-sm outline-none last:border-0',
        'data-[selected]:bg-accent-100 data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-border-focus-ring',
        'data-[hovered]:bg-background-secondary-default/50',
        className as string,
      )}
    />
  )
}

function ListViewItemContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="list-view-item-content" {...props} className={cx('min-w-0 flex-1', className)} />
}

function ListViewTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="list-view-title" {...props} className={cx('font-medium', className)} />
}

function ListViewItemAction({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="list-view-item-action" {...props} className={cx('flex shrink-0 items-center', className)} />
}

export const ListView = Object.assign(ListViewRoot, {
  Item: ListViewItem,
  ItemContent: ListViewItemContent,
  Title: ListViewTitle,
  ItemAction: ListViewItemAction,
})
