import './usage-heatmap.css'
import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Focusable } from 'react-aria-components'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { heatmapMove, heatmapStep } from '@/lib/heatmap'

const STEP_LEVELS = [0, 1, 2, 3, 4] as const

/**
 * A rows × columns grid of counts (weekday × hour, for the usage page).
 *
 * Pointing at a cell, focusing it or pressing it outlines it, writes its
 * caption in the line under the grid, and opens an accessible tooltip on hover
 * or keyboard focus.
 *
 * It is an ARIA grid with one tab stop: Tab lands on the active cell and the
 * arrow keys (Home/End, with Ctrl for the corners) move within it, so 168
 * cells cost a keyboard user one Tab rather than 168.
 */
export function UsageHeatmap({
  data,
  rowLabels,
  columnLabel,
  caption,
  less,
  more,
  'aria-label': ariaLabel,
}: {
  data: readonly (readonly number[])[]
  rowLabels: readonly string[]
  /** The label under a column, or `''` to leave it blank. */
  columnLabel: (column: number) => string
  /** What a cell says about itself: its accessible name, tooltip, and caption line. */
  caption: (row: number, column: number, value: number) => string
  less: string
  more: string
  'aria-label': string
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
    setHover(null)
    setActive(next)
    grid.current?.querySelector<HTMLElement>(`[data-row="${next[0]}"][data-column="${next[1]}"]`)?.focus()
  }

  return (
    <div data-slot="activity-heatmap" className="m-usage-heatmap">
      <div
        ref={grid}
        data-slot="activity-heatmap-grid"
        role="grid"
        aria-label={ariaLabel}
        className="m-usage-heatmap__grid"
        style={{ ['--heatmap-columns' as string]: columns } as CSSProperties}
        onMouseLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
      >
        {data.map((row, r) => (
          <div key={r} role="row" className="m-usage-heatmap__row">
            <span role="rowheader" className="m-usage-heatmap__row-label">
              {rowLabels[r]}
            </span>
            {row.map((value, c) => {
              const isActiveCell = active[0] === r && active[1] === c
              const isShown = shown?.[0] === r && shown[1] === c
              const cellCaption = caption(r, c, value)
              const step = heatmapStep(value, max)
              return (
                <TooltipTrigger key={c} delay={400}>
                  <Focusable excludeFromTabOrder={!isActiveCell}>
                    <span
                      role="gridcell"
                      data-slot="activity-heatmap-cell"
                      data-row={r}
                      data-column={c}
                      data-step={step}
                      data-active={isShown || undefined}
                      aria-label={cellCaption}
                      tabIndex={isActiveCell ? 0 : -1}
                      onMouseEnter={() => setHover([r, c])}
                      onPointerDown={(event) => {
                        setActive([r, c])
                        event.currentTarget.focus()
                      }}
                      onFocus={() => setActive([r, c])}
                      className="m-usage-heatmap__cell"
                    />
                  </Focusable>
                  <Tooltip>{cellCaption}</Tooltip>
                </TooltipTrigger>
              )
            })}
          </div>
        ))}
        {/* The hour axis is for the eye: every cell's label already names its hour. */}
        <span aria-hidden="true" />
        {Array.from({ length: columns }, (_, c) => (
          <span key={c} aria-hidden="true" className="m-usage-heatmap__col-label">
            {columnLabel(c)}
          </span>
        ))}
      </div>
      <div data-slot="activity-heatmap-footer" aria-hidden="true" className="m-usage-heatmap__footer">
        <span data-slot="activity-heatmap-caption" className="m-usage-heatmap__caption">
          {shown ? caption(shown[0], shown[1], data[shown[0]][shown[1]]) : ''}
        </span>
        <span className="m-usage-heatmap__scale-label">{less}</span>
        {STEP_LEVELS.map((step) => (
          <span key={step} className="m-usage-heatmap__swatch" data-step={step} />
        ))}
        <span className="m-usage-heatmap__scale-label">{more}</span>
      </div>
    </div>
  )
}
