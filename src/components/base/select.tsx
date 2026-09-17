import {
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
  Button as AriaButton,
  Popover as AriaPopover,
  type SelectProps as AriaSelectProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface SelectRootProps {
  'aria-label'?: string
  fullWidth?: boolean
  isDisabled?: boolean
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  selectedKey?: string
  onSelectionChange?: (key: string) => void
  className?: string
  children?: React.ReactNode
}

function SelectRoot({
  className,
  fullWidth: _fw,
  value,
  onChange,
  selectedKey,
  onSelectionChange,
  ...props
}: SelectRootProps) {
  return (
    <AriaSelect
      data-slot="select"
      selectedKey={selectedKey ?? value}
      onSelectionChange={(key) => {
        const k = String(key)
        onSelectionChange?.(k)
        onChange?.(k)
      }}
      {...(props as Omit<AriaSelectProps<object>, 'children'>)}
      className={cn('flex flex-col gap-1.5', className)}
    >
      {props.children}
    </AriaSelect>
  )
}

function SelectTrigger({ className, ...props }: ComponentProps<'div'>) {
  return (
    <AriaButton
      data-slot="select-trigger"
      className={cn(
        'flex w-full items-center justify-between rounded-field border border-field-border bg-field px-3 py-2 text-sm outline-none',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus',
        className,
      )}
    >
      <span data-slot="select-trigger-content" {...props} />
    </AriaButton>
  )
}

function SelectValue({ className, ...props }: ComponentProps<'span'>) {
  return <AriaSelectValue data-slot="select-value" {...props} className={cn('truncate', className)} />
}

function SelectIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="select-indicator" {...props} className={cn('text-muted', className)}>
      <svg data-slot="select-chevron" className="size-3" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.427 6.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 6H4.604a.25.25 0 00-.177.427z" />
      </svg>
    </span>
  )
}

function SelectPopover({ className, ...props }: ComponentProps<'div'> & { placement?: string }) {
  return (
    <AriaPopover
      data-slot="select-popover"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- popover props passthrough
      {...(props as any)}
      className={cn(
        'min-w-[var(--trigger-width)] overflow-hidden rounded-xl border border-border bg-overlay p-1 shadow-overlay',
        'data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95',
        'data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95',
        className,
      )}
    />
  )
}

export const Select = Object.assign(SelectRoot, {
  Trigger: SelectTrigger,
  Value: SelectValue,
  Indicator: SelectIndicator,
  Popover: SelectPopover,
})
