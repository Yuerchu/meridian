import type { ComponentProps, ReactNode } from 'react'
import { ProgressBar as AriaProgressBar, type ProgressBarProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

/**
 * A ring that fills. React Aria's `ProgressBar` supplies the `progressbar`
 * role, the value attributes and the indeterminate state; the drawing is one
 * SVG that scales with the element, so the size is set with `size-*` on the
 * root (or the `size` preset) and never with a prop the SVG has to be told
 * about twice. Indeterminate spins the arc.
 *
 * The stroke colour is `--progress-circle-stroke` (default accent); a status
 * ring sets it on the root: `[--progress-circle-stroke:var(--color-status-warning)]`.
 */
export type ProgressCircleColor = 'accent' | 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface ProgressCircleProps extends Omit<ProgressBarProps, 'className' | 'children' | 'style'> {
  size?: 'sm' | 'md' | 'lg'
  color?: ProgressCircleColor
  className?: string
  children?: ReactNode
}

const sizes = { sm: 'size-4', md: 'size-6', lg: 'size-8' }

const strokes: Record<ProgressCircleColor, string> = {
  accent: '[--progress-circle-stroke:var(--color-accent-500)]',
  neutral: '[--progress-circle-stroke:var(--color-text-tertiary)]',
  success: '[--progress-circle-stroke:var(--color-status-success)]',
  warning: '[--progress-circle-stroke:var(--color-status-warning)]',
  danger: '[--progress-circle-stroke:var(--color-status-danger)]',
  info: '[--progress-circle-stroke:var(--color-status-info)]',
}

const R = 10.5 // in a 24-unit box with a 3-unit stroke
const C = 2 * Math.PI * R

function ProgressCircleRoot({ size = 'md', color = 'accent', className, children, ...props }: ProgressCircleProps) {
  return (
    <AriaProgressBar
      data-slot="progress-circle"
      data-color={color}
      {...props}
      className={cx('inline-flex shrink-0 items-center justify-center', sizes[size], strokes[color], className)}
    >
      {({ percentage, isIndeterminate }) => (
        <>
          <svg
            data-slot="progress-circle-svg"
            viewBox="0 0 24 24"
            className={cx('size-full -rotate-90', isIndeterminate && 'motion-safe:animate-spin-fast')}
          >
            <circle
              cx={12}
              cy={12}
              r={R}
              fill="none"
              // The track has to show on the surface the ring sits on, or a
              // part-filled ring is an arc alone — a spinner. The tertiary fill
              // it used is the primary surface itself in the dark theme.
              stroke="var(--color-border-button-default)"
              strokeWidth={3}
            />
            <circle
              cx={12}
              cy={12}
              r={R}
              fill="none"
              stroke="var(--progress-circle-stroke, var(--color-accent-500))"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={isIndeterminate ? C * 0.75 : C * (1 - (percentage ?? 0) / 100)}
              className="transition-[stroke-dashoffset] duration-300 ease-out"
            />
          </svg>
          {children}
        </>
      )}
    </AriaProgressBar>
  )
}

/** Kept for call-site compatibility: the ring is drawn by the root. */
function ProgressCirclePart(_props: ComponentProps<'span'>) {
  return null
}

export const ProgressCircle = Object.assign(ProgressCircleRoot, {
  Track: ProgressCirclePart,
  TrackCircle: ProgressCirclePart,
  FillCircle: ProgressCirclePart,
})
