import { useRef, useState, type KeyboardEvent } from 'react'
import { heatmapMove, heatmapStep } from '@/lib/heatmap'
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

/**
 * A rows × columns grid of counts (weekday × hour, for the usage page).
 *
 * Pointing at a cell, focusing it or pressing it outlines it and writes its
 * caption in the line under the grid, where it does not cover the neighbouring
 * cells the way a tooltip would.
 *
 * It is an ARIA grid with one tab stop: Tab lands on the active cell and the
 * arrow keys (Home/End, with Ctrl for the corners) move within it, so 168
 * cells cost a keyboard user one Tab rather than 168. Each cell is labelled
 * with its own caption, which is what a screen reader reads on focus; the
 * visible caption line is therefore hidden from it, or every move would be
 * announced twice.
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
  /** What a cell says about itself: its accessible name and the caption line. */
  caption: (row: number, column: number, value: number) => string
  less: string
  more: string
  'aria-label': string
  color?: string
  className?: string
}) {
  const [hover, setHover] = useState<[number, number] | null>(null)
  /** The roving tab stop, and the cell outlined while the grid has focus. */
  const [active, setActive] = useState<[number, number]>([0, 0])
  const [focused, setFocused] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  const rows = data.length
  const columns = data[0]?.length ?? 0
  const max = Math.max(0, ...data.flat())
  const shown = hover ?? (focused ? active : null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = heatmapMove(event.key, active, rows, columns, event.ctrlKey || event.metaKey)
    if (!next) return
    event.preventDefault()
    // The pointer may still rest on a cell; the caption follows whichever
    // input moved last, or it would keep naming the cell under the mouse.
    setHover(null)
    setActive(next)
    grid.current?.querySelector<HTMLElement>(`[data-row="${next[0]}"][data-column="${next[1]}"]`)?.focus()
  }

  return (
    <div
      data-slot="activity-heatmap"
      className={cx('flex min-w-0 flex-col gap-2', className)}
      style={{ ['--heatmap-color' as string]: color }}
    >
      <div
        ref={grid}
        data-slot="activity-heatmap-grid"
        role="grid"
        aria-label={ariaLabel}
        className="grid items-center gap-[3px]"
        style={{ gridTemplateColumns: `2rem repeat(${columns}, minmax(0, 1fr))` }}
        onMouseLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
      >
        {data.map((row, r) => (
          <div key={r} role="row" className="contents">
            <span role="rowheader" className="truncate text-caption-2-regular text-text-secondary">
              {rowLabels[r]}
            </span>
            {row.map((value, c) => {
              const isShown = shown?.[0] === r && shown[1] === c
              return (
                <span
                  key={c}
                  role="gridcell"
                  data-slot="activity-heatmap-cell"
                  data-row={r}
                  data-column={c}
                  data-step={heatmapStep(value, max)}
                  aria-label={caption(r, c, value)}
                  tabIndex={active[0] === r && active[1] === c ? 0 : -1}
                  onMouseEnter={() => setHover([r, c])}
                  // A tap focuses a tabbable cell in most browsers, but not all;
                  // setting it on press makes touch reliable either way.
                  onPointerDown={() => setActive([r, c])}
                  onFocus={() => setActive([r, c])}
                  className={cx(
                    'aspect-square rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                    isShown && 'ring-[1.5px] ring-text-primary',
                  )}
                  style={{ backgroundColor: STEPS[heatmapStep(value, max)] }}
                />
              )
            })}
          </div>
        ))}
        {/* The hour axis is for the eye: every cell's label already names its hour. */}
        <span aria-hidden="true" />
        {Array.from({ length: columns }, (_, c) => (
          <span key={c} aria-hidden="true" className="text-caption-2-regular whitespace-nowrap text-text-secondary">
            {columnLabel(c)}
          </span>
        ))}
      </div>
      <div
        data-slot="activity-heatmap-footer"
        aria-hidden="true"
        className="flex items-center gap-2 text-caption-1-regular"
      >
        <span data-slot="activity-heatmap-caption" className="min-h-4 flex-1 truncate text-text-primary tabular-nums">
          {shown ? caption(shown[0], shown[1], data[shown[0]][shown[1]]) : ''}
        </span>
        <span className="text-text-secondary">{less}</span>
        {STEPS.map((step, i) => (
          <span key={i} className="size-2.5 rounded-xs" style={{ backgroundColor: step }} />
        ))}
        <span className="text-text-secondary">{more}</span>
      </div>
    </div>
  )
}

export { ActivityHeatmap }
