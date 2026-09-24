'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight } from '@keyline-icons/react/two-tone'
import { Button as AriaButton } from 'react-aria-components'
import { Button } from '@/components/base/buttons/button'
import { cx } from '@/utils/cx'

/**
 * Pagination — designed to match the Board UI dashboard style (no dedicated
 * Figma frame yet, so it reuses shipped tokens/components):
 *   - Previous / Next use the secondary small `Button` (same as the Recent
 *     hires card pager) with arrow icons.
 *   - Page numbers are 32×32 (radius/lg) cells. Active cell borrows the
 *     secondary-button surface (white + border/button/default + shadow/xs);
 *     inactive cells are ghost with a secondary-hover background on hover.
 *   - Overflow collapses to leading/trailing dots around a sibling window.
 *
 * Below `COMPACT_WIDTH`, a `ResizeObserver` on the nav switches to a compact
 * layout — icon-only Previous/Next and `siblingCount` clamped to 0 — so the
 * row never overflows a narrow container instead of clipping mid-label.
 *
 * Controlled: pass `page`, `totalPages`, and `onChange`.
 *
 * Meridian (boardui.json patches): the page cells are React Aria `Button`s and
 * Previous/Next are wired with `onPress`/`isDisabled` (the base Button is RAC
 * here); the visible and accessible strings are props, so a caller can
 * translate them; and the width observer attaches whenever the nav mounts,
 * not only if it existed on the first render.
 */

export interface PaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
  /** Page numbers shown on each side of the current page. Default 1. */
  siblingCount?: number
  className?: string
  /** The nav's accessible name. Default "Pagination". */
  'aria-label'?: string
  previousLabel?: string
  nextLabel?: string
  /** A page cell's accessible name. Default "Go to page N". */
  pageLabel?: (page: number) => string
}

const DOTS = 'dots'

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

function paginationRange(current: number, total: number, sibling: number): (number | typeof DOTS)[] {
  // first + last + current + 2*sibling + 2 dots
  const totalPageNumbers = sibling * 2 + 5
  if (totalPageNumbers >= total) return range(1, total)

  const leftSibling = Math.max(current - sibling, 1)
  const rightSibling = Math.min(current + sibling, total)
  const showLeftDots = leftSibling > 2
  const showRightDots = rightSibling < total - 2

  if (!showLeftDots && showRightDots) {
    return [...range(1, 3 + 2 * sibling), DOTS, total]
  }
  if (showLeftDots && !showRightDots) {
    return [1, DOTS, ...range(total - (2 + 2 * sibling), total)]
  }
  return [1, DOTS, ...range(leftSibling, rightSibling), DOTS, total]
}

// No transition on the cells: animating background/shadow/color makes the
// previously-active number visibly fade out ("flicker") on every page change.
const cell = 'flex size-8 shrink-0 items-center justify-center rounded-lg text-body-medium'

/** Below this nav width, Previous/Next drop their labels and siblingCount
 *  clamps to 0 — the full-label, full-sibling layout starts clipping
 *  somewhere around 380–420px depending on totalPages' digit count. */
const COMPACT_WIDTH = 420

function useIsCompact() {
  // A callback ref rather than an object ref: the nav is not rendered at all
  // while there is one page, so an effect that ran once on mount would never
  // see it once a second page appeared.
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [isCompact, setIsCompact] = useState(false)

  useEffect(() => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setIsCompact(entry.contentRect.width < COMPACT_WIDTH)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])

  return [setEl, isCompact] as const
}

export function Pagination({
  page,
  totalPages,
  onChange,
  siblingCount = 1,
  className,
  'aria-label': ariaLabel = 'Pagination',
  previousLabel = 'Previous',
  nextLabel = 'Next',
  pageLabel = (item) => `Go to page ${item}`,
}: PaginationProps) {
  const [navRef, isCompact] = useIsCompact()
  if (totalPages <= 1) return null
  const pages = paginationRange(page, totalPages, isCompact ? 0 : siblingCount)

  return (
    <nav
      ref={navRef}
      aria-label={ariaLabel}
      className={cx('flex w-full items-center justify-between gap-2', className)}
    >
      <Button
        variant="secondary"
        size="small"
        iconOnly={isCompact}
        leadingIcon={ArrowLeft}
        aria-label={isCompact ? previousLabel : undefined}
        isDisabled={page <= 1}
        onPress={() => onChange(page - 1)}
      >
        {isCompact ? undefined : previousLabel}
      </Button>

      <ul className="flex min-w-0 items-center gap-0.5">
        {pages.map((item, i) =>
          item === DOTS ? (
            <li key={`dots-${i}`} aria-hidden className={cx(cell, 'text-text-tertiary')}>
              …
            </li>
          ) : (
            <li key={item}>
              <AriaButton
                aria-label={pageLabel(item)}
                aria-current={item === page ? 'page' : undefined}
                onPress={() => onChange(item)}
                className={cx(
                  cell,
                  'cursor-pointer outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-border-focus-ring',
                  item === page
                    ? 'border border-border-button-default bg-background-primary-default text-text-primary shadow-xs'
                    : 'text-text-secondary data-[hovered]:bg-background-secondary-hover data-[hovered]:text-text-primary',
                )}
              >
                {item}
              </AriaButton>
            </li>
          ),
        )}
      </ul>

      <Button
        variant="secondary"
        size="small"
        iconOnly={isCompact}
        leadingIcon={isCompact ? ArrowRight : undefined}
        trailingIcon={isCompact ? undefined : ArrowRight}
        aria-label={isCompact ? nextLabel : undefined}
        isDisabled={page >= totalPages}
        onPress={() => onChange(page + 1)}
      >
        {isCompact ? undefined : nextLabel}
      </Button>
    </nav>
  )
}
