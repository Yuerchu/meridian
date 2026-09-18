import {
  Checkbox as AriaCheckbox,
  CheckboxGroup as AriaCheckboxGroup,
  type CheckboxProps as AriaCheckboxProps,
  type CheckboxGroupProps as AriaCheckboxGroupProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

function CheckboxRoot({
  className,
  variant: _variant,
  ...props
}: AriaCheckboxProps & { className?: string; variant?: string }) {
  return (
    <AriaCheckbox
      data-slot="checkbox"
      {...props}
      className={cx(
        'group inline-flex items-center gap-2 select-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

function CheckboxContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="checkbox-content" {...props} className={cx('inline-flex items-center gap-2', className)} />
}

function CheckboxControl({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="checkbox-control"
      {...props}
      className={cx(
        'flex size-4 shrink-0 items-center justify-center rounded-sm',
        'border border-border-checkbox-default bg-background-primary-default shadow-xs',
        'transition-[background,border-color,box-shadow] duration-150 ease',
        'group-data-[hovered]:border-border-checkbox-hover',
        'group-data-[selected]:border-transparent group-data-[selected]:bg-linear-to-b group-data-[selected]:from-accent-500 group-data-[selected]:to-accent-600 group-data-[selected]:shadow-checkbox-selected',
        'group-data-[indeterminate]:border-transparent group-data-[indeterminate]:bg-linear-to-b group-data-[indeterminate]:from-accent-500 group-data-[indeterminate]:to-accent-600 group-data-[indeterminate]:shadow-checkbox-selected',
        'group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-border-focus-ring group-data-[focus-visible]:ring-offset-2',
        className,
      )}
    />
  )
}

function CheckboxIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="checkbox-indicator"
      {...props}
      className={cx('hidden group-data-[selected]:block group-data-[indeterminate]:block', className)}
    >
      <svg className="size-4" viewBox="0 0 16 16" fill="none">
        <path
          d="M4 7.7002L6.64645 10.3466C6.84171 10.5419 7.15829 10.5419 7.35355 10.3466L12 5.7002"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="animate-check-draw"
        />
      </svg>
    </span>
  )
}

export const Checkbox = Object.assign(CheckboxRoot, {
  Content: CheckboxContent,
  Control: CheckboxControl,
  Indicator: CheckboxIndicator,
})

export function CheckboxGroup({ className, ...props }: AriaCheckboxGroupProps & { className?: string }) {
  return <AriaCheckboxGroup data-slot="checkbox-group" {...props} className={cx('flex flex-col gap-2', className)} />
}
