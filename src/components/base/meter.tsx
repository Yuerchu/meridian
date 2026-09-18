import type { ComponentProps, ReactNode } from 'react'
import { Meter as AriaMeter, type MeterProps as AriaMeterProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

/**
 * A level, not a progress: React Aria's `Meter` gives it the `meter` role and
 * the value attributes. The root writes the percentage into
 * `--meter-percentage`, which is how `Meter.Fill` — a plain div two levels
 * down — knows how wide to be without a render prop threading through.
 */
export interface MeterProps extends Omit<AriaMeterProps, 'className' | 'children' | 'style'> {
  className?: string
  children?: ReactNode
}

function MeterRoot({ className, children, ...props }: MeterProps) {
  return (
    <AriaMeter
      data-slot="meter"
      {...props}
      className={cx('flex w-full flex-col gap-1', className)}
      style={({ percentage }) => ({ '--meter-percentage': `${percentage ?? 0}%` }) as React.CSSProperties}
    >
      {children}
    </AriaMeter>
  )
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
      className={cx(
        'h-full w-[var(--meter-percentage)] rounded-full bg-accent-500 transition-[width] duration-150 ease-out',
        className,
      )}
    />
  )
}

export const Meter = Object.assign(MeterRoot, { Track: MeterTrack, Fill: MeterFill })
