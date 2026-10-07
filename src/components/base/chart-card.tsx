import type { ComponentProps, ReactNode } from 'react'
import { cx } from '@/utils/cx'

/**
 * A chart with its title, on the same flat panel the `KPI` cards use, so a
 * page of figures and a page of charts read as one set of surfaces. The title
 * is a real heading: a chart is found by what it is about.
 *
 * `action` sits at the right of the title row (a filter, a toggle); anything
 * the chart draws goes in `children`, legend included, because only the chart
 * knows which series it actually drew.
 */
function ChartCard({
  title,
  action,
  className,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & { title: ReactNode; action?: ReactNode }) {
  return (
    <section
      data-slot="chart-card"
      {...props}
      className={cx('flex min-w-0 flex-col gap-3 rounded-2xl bg-background-secondary-default p-4', className)}
    >
      <div data-slot="chart-card-header" className="flex min-w-0 items-start gap-3">
        <h3 data-slot="chart-card-title" className="min-w-0 flex-1 truncate text-body-medium text-text-secondary">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** One swatch and name per series, in the order the chart stacks them. */
function ChartLegend({
  items,
  className,
}: {
  items: readonly { key: string; color: string; label: ReactNode }[]
  className?: string
}) {
  return (
    <div data-slot="chart-legend" className={cx('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {items.map((item) => (
        <span key={item.key} data-slot="chart-legend-item" className="flex items-center gap-1.5">
          <span
            data-slot="chart-legend-swatch"
            aria-hidden="true"
            className="size-2 rounded-xs"
            style={{ backgroundColor: item.color }}
          />
          <span data-slot="chart-legend-label" className="text-caption-1-medium text-text-secondary">
            {item.label}
          </span>
        </span>
      ))}
    </div>
  )
}

export { ChartCard, ChartLegend }
