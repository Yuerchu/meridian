import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

type CellSwitchSize = 'sm' | 'md'

interface CellSwitchProps extends AriaSwitchProps {
  size?: CellSwitchSize
}

function CellSwitchRoot({ className, size: _size, ...props }: CellSwitchProps) {
  return <AriaSwitch data-slot="cell-switch" {...props} className={cx('group', className as string)} />
}

function CellSwitchTrigger({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="cell-switch-trigger"
      {...props}
      className={cx(
        'flex h-11 min-h-10 w-full items-center gap-3 rounded-lg border border-border-button-default bg-background-primary-default px-3 py-2 shadow-xs transition-colors',
        'group-data-[hovered]:bg-background-secondary-default/50',
        className,
      )}
    />
  )
}

function CellSwitchLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="cell-switch-label" {...props} className={cx('flex-1 text-sm font-medium', className)} />
}

function CellSwitchControl({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="cell-switch-control"
      {...props}
      className={cx(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200',
        'bg-background-tertiary-default group-data-[selected]:bg-accent-500',
        className,
      )}
    >
      <span
        data-slot="cell-switch-thumb"

        className="pointer-events-none block size-4 translate-x-1 rounded-full bg-white shadow-sm transition-transform duration-200 group-data-[selected]:translate-x-5"
      />
    </span>
  )
}

function CellSwitchDescription({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="cell-switch-description" {...props} className={cx('text-xs text-text-secondary', className)} />
  )
}

export const CellSwitch = Object.assign(CellSwitchRoot, {
  Trigger: CellSwitchTrigger,
  Label: CellSwitchLabel,
  Control: CellSwitchControl,
  Description: CellSwitchDescription,
})
