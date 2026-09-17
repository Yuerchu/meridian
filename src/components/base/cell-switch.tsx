import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type CellSwitchSize = 'sm' | 'md'

interface CellSwitchProps extends AriaSwitchProps {
  size?: CellSwitchSize
}

function CellSwitchRoot({ className, size: _size, ...props }: CellSwitchProps) {
  return <AriaSwitch data-slot="cell-switch" {...props} className={cn('group', className)} />
}

function CellSwitchTrigger({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="cell-switch-trigger"
      {...props}
      className={cn(
        'flex h-11 min-h-10 w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 shadow-surface transition-colors',
        'group-data-[hovered]:bg-default/50',
        className,
      )}
    />
  )
}

function CellSwitchLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="cell-switch-label" {...props} className={cn('flex-1 text-sm font-medium', className)} />
}

function CellSwitchControl({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="cell-switch-control"
      {...props}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200',
        'bg-default group-data-[selected]:bg-accent',
        className,
      )}
    >
      <span
        data-slot="cell-switch-thumb"
        // eslint-disable-next-line no-restricted-syntax -- thumb needs literal white fill and shadow
        className="pointer-events-none block size-4 translate-x-1 rounded-full bg-white shadow-sm transition-transform duration-200 group-data-[selected]:translate-x-5"
      />
    </span>
  )
}

function CellSwitchDescription({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="cell-switch-description" {...props} className={cn('text-xs text-muted', className)} />
}

export const CellSwitch = Object.assign(CellSwitchRoot, {
  Trigger: CellSwitchTrigger,
  Label: CellSwitchLabel,
  Control: CellSwitchControl,
  Description: CellSwitchDescription,
})
