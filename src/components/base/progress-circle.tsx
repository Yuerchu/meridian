import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface ProgressCircleProps extends ComponentProps<'div'> {
  isIndeterminate?: boolean
  value?: number
  maxValue?: number
  size?: 'sm' | 'md' | 'lg'
  'aria-label'?: string
}

const sizes = { sm: 16, md: 24, lg: 32 }

function ProgressCircleTrack({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="progress-circle-track" {...props} className={cn('', className)}>
      {children}
    </div>
  )
}
function ProgressCircleTrackCircle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="progress-circle-track-circle" {...props} className={cn('', className)} />
}
function ProgressCircleFillCircle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="progress-circle-fill-circle" {...props} className={cn('', className)} />
}

function ProgressCircleRoot({
  className,
  value = 0,
  maxValue = 100,
  size = 'md',
  isIndeterminate: _isIndeterminate,
  ...props
}: ProgressCircleProps) {
  const s = sizes[size]
  const r = (s - 3) / 2
  const c = 2 * Math.PI * r
  const pct = Math.min(value / maxValue, 1)

  return (
    <div
      data-slot="progress-circle"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={maxValue}
      {...props}
      className={cn('inline-flex shrink-0', className)}
    >
      <svg data-slot="progress-circle-svg" width={s} height={s} viewBox={`0 0 ${s} ${s}`} className="rotate-[-90deg]">
        <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke="var(--default)" strokeWidth={2.5} />
        <circle
          cx={s / 2}
          cy={s / 2}
          r={r}
          fill="none"
          stroke="var(--progress-circle-stroke, var(--accent))"
          strokeWidth={2.5}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

export const ProgressCircle = Object.assign(ProgressCircleRoot, {
  Track: ProgressCircleTrack,
  TrackCircle: ProgressCircleTrackCircle,
  FillCircle: ProgressCircleFillCircle,
})
