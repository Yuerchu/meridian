import {
  Checkbox as AriaCheckbox,
  CheckboxGroup as AriaCheckboxGroup,
  type CheckboxProps as AriaCheckboxProps,
  type CheckboxGroupProps as AriaCheckboxGroupProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function CheckboxRoot({ className, ...props }: AriaCheckboxProps & { className?: string }) {
  return (
    <AriaCheckbox
      data-slot="checkbox"
      {...props}
      className={cn('group flex items-center gap-2 text-sm', 'data-[disabled]:opacity-50', className)}
    />
  )
}

function CheckboxContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="checkbox-content" {...props} className={cn('inline-flex items-center gap-2', className)} />
}

function CheckboxControl({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="checkbox-control"
      {...props}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-sm border border-border transition-colors',
        'group-data-[selected]:border-accent group-data-[selected]:bg-accent group-data-[selected]:text-accent-foreground',
        className,
      )}
    />
  )
}

function CheckboxIndicator({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="checkbox-indicator" {...props} className={cn('hidden group-data-[selected]:block', className)}>
      <svg
        data-slot="checkbox-check-icon"
        className="size-3"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M3.5 8.5l3 3 6-6" />
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
  return <AriaCheckboxGroup data-slot="checkbox-group" {...props} className={cn('flex flex-col gap-2', className)} />
}
