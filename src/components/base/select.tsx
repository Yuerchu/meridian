import {
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
  Button as AriaButton,
  Popover as AriaPopover,
  type SelectProps as AriaSelectProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'
import { ChevronDownSmall } from '@/components/foundations/icons/chevrons'
import { MENU_POPOVER_SURFACE } from './dropdown/menu-styles'

interface SelectRootProps {
  'aria-label'?: string
  fullWidth?: boolean
  isDisabled?: boolean
  placeholder?: string
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  selectedKey?: string
  defaultSelectedKey?: string
  onSelectionChange?: (key: string) => void
  className?: string
  children?: React.ReactNode
}

function SelectRoot({
  className,
  fullWidth: _fw,
  value,
  defaultValue: _dv,
  onChange,
  selectedKey,
  defaultSelectedKey: _dsk,
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
      className={cx('group flex flex-col gap-1.5', className)}
    >
      {props.children}
    </AriaSelect>
  )
}

function SelectTrigger({ className, ...props }: ComponentProps<'div'>) {
  return (
    <AriaButton
      data-slot="select-trigger"
      className={cx(
        'flex w-full cursor-pointer items-center justify-between rounded-2lg',
        'border border-border-button-default bg-background-primary-default px-2.5 py-2 text-body-medium shadow-xs',
        'text-text-primary',
        'transition-[background-color,border-color,box-shadow] duration-200 ease',
        'hover:bg-background-primary-hover hover:border-border-button-hover',
        'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-border-focus-ring',
        'disabled:cursor-not-allowed disabled:bg-background-primary-disabled disabled:text-text-tertiary disabled:shadow-none',
        className,
      )}
    >
      <span data-slot="select-trigger-content" {...props} />
    </AriaButton>
  )
}

function SelectValue({ className, ...props }: ComponentProps<'span'>) {
  return <AriaSelectValue data-slot="select-value" {...props} className={cx('truncate', className)} />
}

function SelectIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="select-indicator" {...props} className={cx('text-text-secondary', className)}>
      <ChevronDownSmall className="size-4 transition-transform duration-200 ease group-data-[open]:rotate-180" />
    </span>
  )
}

function SelectPopover({ className, ...props }: ComponentProps<'div'> & { placement?: string }) {
  return (
    <AriaPopover
      data-slot="select-popover"
      offset={4}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- popover props passthrough
      {...(props as any)}
      className={cx('min-w-[var(--trigger-width)]', MENU_POPOVER_SURFACE, 'p-2', className)}
    />
  )
}

export const Select = Object.assign(SelectRoot, {
  Trigger: SelectTrigger,
  Value: SelectValue,
  Indicator: SelectIndicator,
  Popover: SelectPopover,
})
