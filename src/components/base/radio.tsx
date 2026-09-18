import {
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  type RadioProps as AriaRadioProps,
  type RadioGroupProps as AriaRadioGroupProps,
} from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

function RadioRoot({ className, ...props }: AriaRadioProps & { className?: string }) {
  return (
    <AriaRadio
      data-slot="radio"
      {...props}
      className={cx(
        'group inline-flex items-center gap-2 select-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

function RadioContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="radio-content" {...props} className={cx('inline-flex items-center gap-2', className)} />
}

function RadioControl({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="radio-control"
      {...props}
      className={cx('relative flex size-4 shrink-0 items-center justify-center rounded-full', className)}
    >
      {/* Default surface */}
      <span
        className={cx(
          'absolute inset-0 rounded-full border border-border-checkbox-default bg-background-primary-default shadow-xs',
          'transition-opacity duration-200 ease',
          'group-data-[selected]:opacity-0',
        )}
      />
      {/* Selected gradient surface */}
      <span
        className={cx(
          'absolute inset-0 rounded-full',
          'bg-gradient-to-b from-accent-500 to-accent-600',
          'shadow-[inset_0px_0px_0px_1px_var(--color-accent-500),inset_0px_2px_0px_0px_rgba(255,255,255,0.25)]',
          'transition-opacity duration-200 ease',
          'opacity-0 group-data-[selected]:opacity-100',
        )}
      />
      {/* Inner white dot */}
      <span
        className={cx(
          'absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-control-indicator-background',
          'transition-[scale,opacity] duration-200 ease',
          'scale-0 opacity-0 group-data-[selected]:scale-100 group-data-[selected]:opacity-100',
        )}
      />
    </span>
  )
}

function RadioIndicator({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="radio-indicator" {...props} className={cx('contents', className)} />
}

export const Radio = Object.assign(RadioRoot, {
  Content: RadioContent,
  Control: RadioControl,
  Indicator: RadioIndicator,
})

export function RadioGroup({ className, ...props }: AriaRadioGroupProps & { className?: string }) {
  return <AriaRadioGroup data-slot="radio-group" {...props} className={cx('flex flex-col gap-2', className)} />
}
