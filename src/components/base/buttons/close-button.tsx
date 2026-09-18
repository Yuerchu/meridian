import type { Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { cx, sortCx } from '@/utils/cx'

/**
 * boardui CloseButton — the circular "X" for toasts, modals, sheets and chips —
 * on a React Aria `Button`, for the reason given in `./button.tsx`: it is used
 * as a `Dialog`'s `slot="close"` and as a `TooltipTrigger` child, and both are
 * wired through context that only a RAC pressable receives.
 *
 * One hand-drawn glyph per size rather than one icon scaled, so the stroke is a
 * literal CSS pixel value at every size:
 *
 *   2xs = 16 container, 6.8px glyph, 1.6px stroke
 *   xs  = 20 container, 10.8px glyph, 2px stroke
 *   sm  = 24 container, 12.6px glyph, 2px stroke
 *   md  = 32 container, 16.2px glyph, 2.5px stroke
 */

type CloseButtonSize = '2xs' | 'xs' | 'sm' | 'md'

export interface CloseButtonProps extends Omit<AriaButtonProps, 'children' | 'className' | 'style'> {
  size?: CloseButtonSize
  /** Accessible name — required since there is no visible label. */
  'aria-label': string
  className?: string
  ref?: Ref<HTMLButtonElement>
}

const GLYPH_SIZE: Record<CloseButtonSize, number> = { '2xs': 6.8, xs: 10.8, sm: 12.6, md: 16.2 }
const STROKE_WIDTH: Record<CloseButtonSize, number> = { '2xs': 1.6, xs: 2, sm: 2, md: 2.5 }
const GLYPH_INSET: Record<CloseButtonSize, number> = { '2xs': 0.57, xs: 2, sm: 2, md: 2 }

const styles = sortCx({
  base: [
    'inline-flex shrink-0 items-center justify-center rounded-full',
    'bg-background-tertiary-default text-foreground-icon-secondary',
    'select-none cursor-[var(--cursor-interactive)]',
    'transition-colors duration-150 ease',
    'data-[hovered]:text-text-primary',
    'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-border-focus-ring',
    'disabled:cursor-not-allowed disabled:text-text-tertiary',
  ].join(' '),
  container: {
    '2xs': 'size-4',
    xs: 'size-5',
    sm: 'size-6',
    md: 'size-8',
  },
})

export function CloseButton({ size = 'xs', className, ref, ...props }: CloseButtonProps) {
  const glyph = GLYPH_SIZE[size]
  const strokeWidth = STROKE_WIDTH[size]
  const inset = GLYPH_INSET[size]

  return (
    <AriaButton ref={ref} {...props} className={cx(styles.base, styles.container[size], className)}>
      <svg width={glyph} height={glyph} viewBox={`0 0 ${glyph} ${glyph}`} fill="none" aria-hidden>
        <path
          d={`M${inset} ${inset}L${glyph - inset} ${glyph - inset}`}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d={`M${glyph - inset} ${inset}L${inset} ${glyph - inset}`}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      </svg>
    </AriaButton>
  )
}
