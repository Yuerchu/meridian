import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function SwitchRoot({ className, ...props }: AriaSwitchProps) {
  return (
    <AriaSwitch
      data-slot="switch"
      {...props}
      className={cn('group inline-flex items-center gap-2 text-sm', 'data-[disabled]:opacity-50', className)}
    />
  )
}

function SwitchContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="switch-content" {...props} className={cn('inline-flex items-center gap-2', className)} />
}

function SwitchControl({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="switch-control"
      {...props}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200',
        'bg-default group-data-[selected]:bg-accent',
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
      className={cn(
        // eslint-disable-next-line no-restricted-syntax -- thumb needs literal white fill and shadow
        'pointer-events-none block size-4 translate-x-1 rounded-full bg-white shadow-sm transition-transform duration-200',
        'group-data-[selected]:translate-x-5',
        className,
      )}
    />
  )
}

export const Switch = Object.assign(SwitchRoot, {
  Content: SwitchContent,
  Control: SwitchControl,
  Thumb: SwitchThumb,
})
