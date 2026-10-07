import type { ReactNode } from 'react'
import { titleIfTruncated } from '@/lib/truncation'
import { cx } from '@/utils/cx'

export interface BarListItem {
  key: string
  label: string
  /** Already formatted: a count, or a cost formatted from its Decimal. */
  value: ReactNode
  /** Bar length as a CSS percentage of the row. Computed by the caller, so a
   *  money ranking can take it from `decimalPercent` instead of a float. */
  width: `${string}%`
  /** Already formatted share, shown at the end of the row. */
  share?: string
}

/**
 * A ranked list with a soft bar behind each row: label, value, share. Reads
 * better than an axis chart for "which of these took most" because every row
 * carries its own figure — nobody has to estimate a length against a scale.
 *
 * The bar is a 14% wash of one series colour, lifted to 26% on hover; the text
 * sits on top of it and stays primary/secondary ink, so contrast does not
 * depend on how long the bar is.
 */
function BarList({
  items,
  color = 'var(--color-chart-6)',
  className,
  'aria-label': ariaLabel,
}: {
  items: readonly BarListItem[]
  color?: string
  className?: string
  'aria-label'?: string
}) {
  return (
    <ul data-slot="bar-list" aria-label={ariaLabel} className={cx('flex min-w-0 flex-col gap-1', className)}>
      {items.map((item) => (
        <li
          key={item.key}
          data-slot="bar-list-row"
          className="group relative flex h-8 min-w-0 items-center gap-2.5 rounded-lg px-2.5"
        >
          <span
            data-slot="bar-list-bar"
            aria-hidden="true"
            className="absolute inset-y-0 start-0 min-w-0.5 rounded-lg bg-[color-mix(in_srgb,var(--bar-list-color)_14%,transparent)] transition-colors duration-150 group-hover:bg-[color-mix(in_srgb,var(--bar-list-color)_26%,transparent)]"
            style={{ width: item.width, ['--bar-list-color' as string]: color }}
          />
          <span
            data-slot="bar-list-label"
            onPointerEnter={titleIfTruncated}
            className="relative min-w-0 flex-1 truncate text-body-2-medium text-text-primary"
          >
            {item.label}
          </span>
          <span data-slot="bar-list-value" className="relative text-body-2-medium text-text-primary tabular-nums">
            {item.value}
          </span>
          {item.share !== undefined && (
            <span
              data-slot="bar-list-share"
              className="relative w-10 text-end text-caption-1-regular text-text-secondary tabular-nums"
            >
              {item.share}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

export { BarList }
