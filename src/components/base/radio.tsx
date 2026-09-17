import {
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  type RadioProps as AriaRadioProps,
  type RadioGroupProps as AriaRadioGroupProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function RadioRoot({ className, ...props }: AriaRadioProps & { className?: string }) {
  return (
    <AriaRadio
      data-slot="radio"
      {...props}
      className={cn('group flex items-center gap-2 text-sm', 'data-[disabled]:opacity-50', className)}
    />
  )
}

function RadioContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="radio-content" {...props} className={cn('inline-flex items-center gap-2', className)} />
}

function RadioControl({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="radio-control"
      {...props}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border border-border transition-colors',
        'group-data-[selected]:border-accent',
        className,
      )}
    >
      <span data-slot="radio-dot" className="size-2 rounded-full bg-transparent group-data-[selected]:bg-accent" />
    </span>
  )
}

function RadioIndicator({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="radio-indicator" {...props} className={cn('hidden group-data-[selected]:block', className)} />
}

export const Radio = Object.assign(RadioRoot, {
  Content: RadioContent,
  Control: RadioControl,
  Indicator: RadioIndicator,
})

export function RadioGroup({ className, ...props }: AriaRadioGroupProps & { className?: string }) {
  return <AriaRadioGroup data-slot="radio-group" {...props} className={cn('flex flex-col gap-2', className)} />
}
