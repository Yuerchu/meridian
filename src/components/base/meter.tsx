import { Meter as AriaMeter, type MeterProps as AriaMeterProps } from 'react-aria-components'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface MeterProps extends AriaMeterProps {
  className?: string
}

function MeterRoot({ className, ...props }: MeterProps) {
  return <AriaMeter data-slot="meter" {...props} className={cx('flex flex-col gap-1', className)} />
}

function MeterTrack({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="meter-track"
      {...props}
      className={cx('h-2 w-full overflow-hidden rounded-full bg-background-tertiary-default', className)}
    />
  )
}

function MeterFill({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="meter-fill"
      {...props}
      className={cx('h-full rounded-full bg-accent-500 transition-all', className)}
    />
  )
}

export const Meter = Object.assign(MeterRoot, { Track: MeterTrack, Fill: MeterFill })
