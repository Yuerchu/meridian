import {
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
  Popover as AriaPopover,
  Button as AriaButton,
  type PopoverProps as AriaPopoverProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface InlineSelectProps {
  'aria-label'?: string
  'data-slot'?: string
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  children?: React.ReactNode
  className?: string
}

function InlineSelectRoot({ className, value, onChange, children, ...props }: InlineSelectProps) {
  return (
    <AriaSelect
      data-slot="inline-select"
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key != null) onChange?.(String(key))
      }}
      {...props}
      className={cx('inline-flex', className)}
    >
      {children}
    </AriaSelect>
  )
}

function InlineSelectTrigger({ className, ...props }: ComponentProps<'div'>) {
  return (
    <AriaButton
      data-slot="inline-select-trigger"
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm outline-none transition-colors hover:bg-background-secondary-default',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    >
      <span data-slot="inline-select-trigger-content" {...props} />
    </AriaButton>
  )
}

function InlineSelectValue({ className, ...props }: ComponentProps<'span'>) {
  return <AriaSelectValue data-slot="inline-select-value" {...props} className={cx('truncate', className)} />
}

function InlineSelectIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="inline-select-indicator" {...props} className={cx('text-text-secondary', className)}>
      <svg data-slot="inline-select-chevron" className="size-3" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.427 6.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 6H4.604a.25.25 0 00-.177.427z" />
      </svg>
    </span>
  )
}

function InlineSelectPopover({ className, ...props }: AriaPopoverProps) {
  return (
    <AriaPopover
      data-slot="inline-select-popover"
      {...props}
      className={cx(
        'min-w-[var(--trigger-width)] overflow-hidden rounded-xl border border-border-button-default bg-background-primary-default p-1 shadow-dropdown',
        'data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[entering]:duration-150',
        'data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-100',
        className as string,
      )}
    />
  )
}

export const InlineSelect = Object.assign(InlineSelectRoot, {
  Trigger: InlineSelectTrigger,
  Value: InlineSelectValue,
  Indicator: InlineSelectIndicator,
  Popover: InlineSelectPopover,
})
