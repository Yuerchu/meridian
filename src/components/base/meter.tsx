import { Meter as AriaMeter, type MeterProps as AriaMeterProps } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface MeterProps extends AriaMeterProps {
  className?: string
}

function MeterRoot({ className, ...props }: MeterProps) {
  return <AriaMeter data-slot="meter" {...props} className={cn('flex flex-col gap-1', className)} />
}

function MeterTrack({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="meter-track"
      {...props}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-default', className)}
    />
  )
}

function MeterFill({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="meter-fill" {...props} className={cn('h-full rounded-full bg-accent transition-all', className)} />
  )
}

export const Meter = Object.assign(MeterRoot, { Track: MeterTrack, Fill: MeterFill })
