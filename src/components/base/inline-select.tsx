import {
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
  Popover as AriaPopover,
  Button as AriaButton,
  type PopoverProps as AriaPopoverProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { ChevronDownSmall } from '@/components/foundations/icons/chevrons'
import { cx } from '@/utils/cx'
import { OVERLAY_MOTION } from './overlay-motion'

interface InlineSelectProps {
  'aria-label'?: string
  'data-slot'?: string
  value?: string
  onChange?: (value: string) => void
  isDisabled?: boolean
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
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-body-regular outline-none transition-colors hover:bg-background-secondary-default',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    >
      {/* The trigger's flex row has to reach the value and the chevron: a plain
          inline span between them made the chevron's block-level svg wrap onto
          its own line under the label. */}
      <span data-slot="inline-select-trigger-content" {...props} className="flex min-w-0 items-center gap-1" />
    </AriaButton>
  )
}

function InlineSelectValue({ className, ...props }: ComponentProps<'span'>) {
  return <AriaSelectValue data-slot="inline-select-value" {...props} className={cx('truncate', className)} />
}

function InlineSelectIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="inline-select-indicator"
      {...props}
      className={cx('inline-flex size-4 shrink-0 items-center justify-center text-text-secondary', className)}
    >
      {/* The registry Select's chevron (select.tsx: ChevronDownSmall, text-secondary). */}
      <ChevronDownSmall data-slot="inline-select-chevron" className="size-full" />
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
        OVERLAY_MOTION,
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
