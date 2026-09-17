import { ListBox, ListBoxItem, type ListBoxProps, type ListBoxItemProps } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface ListViewProps<T extends object> extends ListBoxProps<T> {
  variant?: string
}

function ListViewRoot<T extends object>({ className, variant: _variant, ...props }: ListViewProps<T>) {
  return (
    <ListBox
      data-slot="list-view"
      {...props}
      className={cn('flex flex-col overflow-hidden rounded-lg border border-border bg-surface', className)}
    />
  )
}

function ListViewItem({ className, ...props }: ListBoxItemProps) {
  return (
    <ListBoxItem
      data-slot="list-view-item"
      {...props}
      className={cn(
        'flex items-center gap-3 border-b border-separator px-3 py-2.5 text-sm outline-none last:border-0',
        'data-[selected]:bg-accent-soft data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-focus',
        'data-[hovered]:bg-default/50',
        className,
      )}
    />
  )
}

function ListViewItemContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="list-view-item-content" {...props} className={cn('min-w-0 flex-1', className)} />
}

function ListViewTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="list-view-title" {...props} className={cn('font-medium', className)} />
}

function ListViewItemAction({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="list-view-item-action" {...props} className={cn('flex shrink-0 items-center', className)} />
}

export const ListView = Object.assign(ListViewRoot, {
  Item: ListViewItem,
  ItemContent: ListViewItemContent,
  Title: ListViewTitle,
  ItemAction: ListViewItemAction,
})
