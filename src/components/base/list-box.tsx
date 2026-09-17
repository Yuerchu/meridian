import {
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  type ListBoxProps as AriaListBoxProps,
  type ListBoxItemProps as AriaListBoxItemProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic listbox
function ListBoxRoot({ className, ...props }: AriaListBoxProps<any> & { className?: string }) {
  return <AriaListBox data-slot="listbox" {...props} className={cn('flex flex-col', className)} />
}

function ListBoxItem({ className, ...props }: AriaListBoxItemProps & { className?: string }) {
  return (
    <AriaListBoxItem
      data-slot="listbox-item"
      {...props}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none',
        'data-[selected]:bg-accent-soft data-[focused]:bg-default data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-focus',
        'data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

function ListBoxItemIndicator({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="listbox-item-indicator" {...props} className={cn('ml-auto text-accent', className)} />
}

export const ListBox = Object.assign(ListBoxRoot, {
  Item: ListBoxItem,
  ItemIndicator: ListBoxItemIndicator,
})
