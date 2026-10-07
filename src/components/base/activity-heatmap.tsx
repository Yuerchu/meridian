import { useState } from 'react'
import { cx } from '@/utils/cx'

/**
 * Five steps from the empty well to the full series colour. Mixed with
 * `color-mix` over the well rather than with opacity, so a cell reads the same
 * on whatever surface the card sits on.
 */
const STEPS = [
  'var(--color-background-tertiary-default)',
  'color-mix(in srgb, var(--heatmap-color) 25%, var(--color-background-tertiary-default))',
  'color-mix(in srgb, var(--heatmap-color) 50%, var(--color-background-tertiary-default))',
  'color-mix(in srgb, var(--heatmap-color) 75%, var(--color-background-tertiary-default))',
  'var(--heatmap-color)',
] as const

/** Which of the four non-empty steps a value falls on, scaled to the busiest cell. */
export function heatmapStep(value: number, max: number): number {
  return value <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4))
}

/**
 * A rows × columns grid of counts (weekday × hour, for the usage page).
 *
 * Hovering a cell outlines it and writes its caption in the line under the
 * grid, where it does not cover the neighbouring cells the way a tooltip
 * would. The grid itself is one image with a summary label; the caption line
 * is `aria-live`, so a screen reader hears what a pointer would have read.
 */
function ActivityHeatmap({
  data,
  rowLabels,
  columnLabel,
  caption,
  less,
  more,
  'aria-label': ariaLabel,
  color = 'var(--color-chart-6)',
  className,
}: {
  data: readonly (readonly number[])[]
  rowLabels: readonly string[]
  /** The label under a column, or `''` to leave it blank. */
  columnLabel: (column: number) => string
  /** What the caption line says about a hovered cell. */
  caption: (row: number, column: number, value: number) => string
  less: string
  more: string
  'aria-label': string
  color?: string
  className?: string
}) {
  const [hover, setHover] = useState<[number, number] | null>(null)
  const columns = data[0]?.length ?? 0
  const max = Math.max(0, ...data.flat())
  return (
    <div
      data-slot="activity-heatmap"
      className={cx('flex min-w-0 flex-col gap-2', className)}
      style={{ ['--heatmap-color' as string]: color }}
    >
      <div
        data-slot="activity-heatmap-grid"
        role="img"
        aria-label={ariaLabel}
        className="grid items-center gap-[3px]"
        style={{ gridTemplateColumns: `2rem repeat(${columns}, minmax(0, 1fr))` }}
        onMouseLeave={() => setHover(null)}
      >
        {data.map((row, r) => (
          <div key={r} className="contents">
            <span className="truncate text-caption-2-regular text-text-secondary">{rowLabels[r]}</span>
            {row.map((value, c) => (
              <span
                key={c}
                data-slot="activity-heatmap-cell"
                data-step={heatmapStep(value, max)}
                onMouseEnter={() => setHover([r, c])}
                className={cx(
                  'aspect-square rounded-[3px]',
                  hover?.[0] === r && hover[1] === c && 'ring-[1.5px] ring-text-primary',
                )}
                style={{ backgroundColor: STEPS[heatmapStep(value, max)] }}
              />
            ))}
          </div>
        ))}
        <span />
        {Array.from({ length: columns }, (_, c) => (
          <span key={c} className="text-caption-2-regular whitespace-nowrap text-text-secondary">
            {columnLabel(c)}
          </span>
        ))}
      </div>
      <div data-slot="activity-heatmap-footer" className="flex items-center gap-2 text-caption-1-regular">
        <span
          data-slot="activity-heatmap-caption"
          aria-live="polite"
          className="min-h-4 flex-1 truncate text-text-primary tabular-nums"
        >
          {hover ? caption(hover[0], hover[1], data[hover[0]][hover[1]]) : ''}
        </span>
        <span className="text-text-secondary">{less}</span>
        {STEPS.map((step, i) => (
          <span key={i} aria-hidden="true" className="size-2.5 rounded-xs" style={{ backgroundColor: step }} />
        ))}
        <span className="text-text-secondary">{more}</span>
      </div>
    </div>
  )
}

export { ActivityHeatmap }
