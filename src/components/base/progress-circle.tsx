import type { ReactNode } from 'react'
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
          {/* eslint-disable-next-line no-restricted-syntax -- the meter itself: a track and an arc drawn to the value */}
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

/**
 * The ring is drawn by the root alone. There used to be `Track`,
 * `TrackCircle` and `FillCircle` parts "kept for call-site compatibility",
 * which rendered nothing and took a `className` they dropped — so a size
 * written on `Track` (the todo ring's 14px, the lab's 18px) never applied and
 * every such ring was the default 24px. Gone, so that writing one is a type
 * error rather than a size that quietly does not happen.
 */
export const ProgressCircle = ProgressCircleRoot
