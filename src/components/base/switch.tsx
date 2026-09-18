import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

function SwitchRoot({ className, ...props }: AriaSwitchProps) {
  return (
    <AriaSwitch
      data-slot="switch"
      {...props}
      className={(state) =>
        cx(
          'group inline-flex items-center gap-2 select-none',
          state.isDisabled && 'cursor-not-allowed opacity-50',
          typeof className === 'function' ? className(state) : className,
        )
      }
    />
  )
}

function SwitchContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="switch-content" {...props} className={cx('inline-flex items-center gap-2', className)} />
}

function SwitchControl({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="switch-control"
      {...props}
      className={cx(
        'relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-full',
        'transition-colors duration-200 ease',
        'bg-background-tertiary-default',
        'group-data-[selected]:bg-linear-to-b group-data-[selected]:from-accent-500 group-data-[selected]:to-accent-600',
        'group-data-[selected]:shadow-[inset_0_1.5px_0_0_rgb(255_255_255/0.25),inset_0_0_0_0.75px_var(--color-accent-500)]',
        'group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-border-focus-ring group-data-[focus-visible]:ring-offset-2',
        className,
      )}
    />
  )
}

function SwitchThumb({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="switch-thumb"
      {...props}
      className={cx(
        'pointer-events-none absolute left-[3px] top-[3px] flex size-[18px] items-center justify-center rounded-full',
        'bg-linear-to-b from-control-indicator-background from-[43.837%] to-control-indicator-background-subtle',
        'shadow-[0_3px_3px_0_rgb(0_0_0/0.03),0_0.75px_0_0_rgb(0_0_0/0.05)]',
        'transition-transform duration-200 ease',
        'group-data-[selected]:translate-x-[18px]',
        className,
      )}
    >
      {/* Embossed inner chip */}
      <span
        className={cx(
          'size-[7.5px] rounded-full border-[0.375px] border-solid bg-linear-to-t from-[43.837%]',
          'shadow-[0_3px_3px_0_rgb(0_0_0/0.03)]',
          'border-border-button-default/50 from-switch-off-chip-start to-switch-off-chip-end',
          'group-data-[selected]:border-accent-600 group-data-[selected]:from-switch-on-chip-start group-data-[selected]:to-switch-on-chip-end',
        )}
      />
    </span>
  )
}

export const Switch = Object.assign(SwitchRoot, {
  Content: SwitchContent,
  Control: SwitchControl,
  Thumb: SwitchThumb,
})
