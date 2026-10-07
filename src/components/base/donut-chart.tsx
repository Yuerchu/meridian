import { useState } from 'react'
import { cx } from '@/utils/cx'

export interface DonutChartItem {
  key: string
  label: string
  /** A count. Shares are computed in floating point, so never pass money here. */
  value: number
  color: string
}

function arc(c: number, r: number, from: number, to: number): string {
  const x0 = c + r * Math.cos(from)
  const y0 = c + r * Math.sin(from)
  const x1 = c + r * Math.cos(to)
  const y1 = c + r * Math.sin(to)
  return `M${x0},${y0} A${r},${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x1},${y1}`
}

/**
 * Parts of one whole, as a ring with a legend list beside it.
 *
 * Each segment is shortened by its own round cap at both ends, so caps never
 * overlap a neighbour and the gap between segments stays the same at any size.
 * Hovering a segment or its legend row dims the others and puts that part's
 * figure in the centre. The ring is decoration for the list, which carries
 * every figure — so the SVG is hidden from assistive technology.
 *
 * `formatShare` is null when the values are lower bounds: the ring still shows
 * the rough proportions, but no row claims an exact percentage of a whole
 * nobody knows.
 */
function DonutChart({
  items,
  centerValue,
  centerLabel,
  format,
  formatShare,
  size = 136,
  thickness = 14,
  className,
}: {
  items: readonly DonutChartItem[]
  centerValue: string
  centerLabel: string
  format: (value: number) => string
  formatShare: ((share: number) => string) | null
  size?: number
  thickness?: number
  className?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const c = size / 2
  const r = c - thickness / 2 - 2
  const cap = thickness / 2 / r
  const gap = items.length > 1 ? 4 / r : 0
  const dim = (i: number) => (hover === null || hover === i ? 1 : 0.35)

  const sweeps = items.map((item) => (total > 0 ? (item.value / total) * Math.PI * 2 : 0))
  const segments = items.map((item, i) => {
    const start = sweeps.slice(0, i).reduce((sum, sweep) => sum + sweep, -Math.PI / 2)
    const from = start + gap / 2 + cap
    const to = start + sweeps[i] - gap / 2 - cap
    const handlers = { onMouseEnter: () => setHover(i), onMouseLeave: () => setHover(null) }
    if (item.value <= 0) return null
    if (to <= from) {
      // Too small for an arc: a dot the width of the ring, at the middle.
      const mid = (from + to) / 2
      return (
        <circle
          key={item.key}
          cx={c + r * Math.cos(mid)}
          cy={c + r * Math.sin(mid)}
          r={thickness / 2}
          fill={item.color}
          opacity={dim(i)}
          className="transition-opacity duration-150"
          {...handlers}
        />
      )
    }
    return (
      <path
        key={item.key}
        d={arc(c, r, from, to)}
        fill="none"
        stroke={item.color}
        strokeWidth={thickness}
        strokeLinecap="round"
        opacity={dim(i)}
        className="transition-opacity duration-150"
        {...handlers}
      />
    )
  })

  const shown = hover === null ? null : items[hover]
  return (
    <div data-slot="donut-chart" className={cx('flex min-w-0 flex-wrap items-center gap-5', className)}>
      <div data-slot="donut-chart-ring" className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-chart-track)" strokeWidth={thickness} />
          {segments}
        </svg>
        <div
          data-slot="donut-chart-center"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        >
          <span className="text-title-3-semibold text-text-primary tabular-nums">
            {shown ? format(shown.value) : centerValue}
          </span>
          <span className="max-w-[55%] truncate text-caption-1-regular text-text-secondary">
            {shown ? shown.label : centerLabel}
          </span>
        </div>
      </div>
      <ul data-slot="donut-chart-legend" className="flex min-w-40 flex-1 flex-col gap-0.5">
        {items.map((item, i) => (
          <li
            key={item.key}
            data-slot="donut-chart-legend-row"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={cx(
              'grid grid-cols-[0.5rem_minmax(0,1fr)_auto_2.5rem] items-center gap-2 rounded-md px-1.5 py-1 text-caption-1-regular tabular-nums transition-colors duration-150',
              hover === i && 'bg-background-tertiary-default',
            )}
          >
            <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="truncate text-text-secondary">{item.label}</span>
            <span className="text-caption-1-medium text-text-primary">{format(item.value)}</span>
            <span data-slot="donut-chart-legend-share" className="text-end text-text-secondary">
              {formatShare === null ? '' : total > 0 ? formatShare(item.value / total) : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export { DonutChart }
