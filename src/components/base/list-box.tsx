import {
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  type ListBoxProps as AriaListBoxProps,
  type ListBoxItemProps as AriaListBoxItemProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic listbox
function ListBoxRoot({ className, ...props }: AriaListBoxProps<any> & { className?: string }) {
  return <AriaListBox data-slot="listbox" {...props} className={cx('flex flex-col', className)} />
}

function ListBoxItem({ className, ...props }: AriaListBoxItemProps & { className?: string }) {
  return (
    <AriaListBoxItem
      data-slot="listbox-item"
      {...props}
      className={cx(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-body-regular outline-none select-none',
        'data-[selected]:bg-dropdown-item-hover-background data-[focused]:bg-dropdown-item-hover-background data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-border-focus-ring',
        'data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

function ListBoxItemIndicator({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="listbox-item-indicator" {...props} className={cx('ml-auto text-accent-600', className)} />
}

export const ListBox = Object.assign(ListBoxRoot, {
  Item: ListBoxItem,
  ItemIndicator: ListBoxItemIndicator,
})
