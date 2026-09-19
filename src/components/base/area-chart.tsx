import type { ComponentProps, ReactNode } from 'react'
import {
  Area as RechartsArea,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
  type CartesianGridProps,
  type XAxisProps,
  type YAxisProps,
} from 'recharts'
import { cx } from '@/utils/cx'

/**
 * recharts' area chart with the theme applied where recharts would otherwise
 * draw its own defaults: grid and axes in the hairline and secondary text
 * tokens, and a tooltip that is one of this app's panels. Series colours are
 * the caller's — boardui's `chart-1..5` tokens are what they should pass.
 */

interface AreaChartRootProps extends ComponentProps<'div'> {
  data?: Record<string, unknown>[]
  height?: number
}

function AreaChartRoot({ data, height = 200, children, className, ...props }: AreaChartRootProps) {
  return (
    <div data-slot="area-chart" {...props} className={cx('w-full text-caption-1-medium', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsAreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          {children}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function AreaChartGrid(props: CartesianGridProps) {
  return <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-button-default)" {...props} />
}

function AreaChartXAxis(props: XAxisProps) {
  return (
    <RechartsXAxis
      axisLine={false}
      tickLine={false}
      tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
      {...props}
    />
  )
}

function AreaChartYAxis(props: YAxisProps) {
  return (
    <RechartsYAxis
      axisLine={false}
      tickLine={false}
      tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
      {...props}
    />
  )
}

function AreaChartArea(props: ComponentProps<typeof RechartsArea>) {
  return <RechartsArea type="monotone" {...props} />
}

function AreaChartTooltip(props: ComponentProps<typeof RechartsTooltip>) {
  return <RechartsTooltip cursor={{ stroke: 'var(--color-border-button-hover)' }} {...props} />
}

interface AreaChartTooltipContentProps {
  indicator?: 'line' | 'dot'
  valueFormatter?: (value: string | number) => string
  labelFormatter?: (label: ReactNode) => ReactNode
  className?: string
  /* Injected by recharts when this element is handed to `Tooltip content`. */
  active?: boolean
  label?: ReactNode
  payload?: ReadonlyArray<{
    name?: string | number
    value?: string | number
    color?: string
    dataKey?: string | number
  }>
}

function AreaChartTooltipContent({
  indicator = 'dot',
  valueFormatter = (v) => String(v),
  labelFormatter,
  className,
  active,
  label,
  payload,
}: AreaChartTooltipContentProps) {
  if (!active || !payload?.length) return null
  return (
    <div
      data-slot="area-chart-tooltip-content"
      className={cx(
        'min-w-32 rounded-xl border border-border-button-default bg-background-primary-default p-2.5 shadow-dropdown',
        className,
      )}
    >
      {label != null && (
        <div data-slot="area-chart-tooltip-label" className="mb-1.5 text-caption-1-medium text-text-secondary">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <ul data-slot="area-chart-tooltip-series" className="flex flex-col gap-1">
        {payload.map((entry, i) => (
          <li key={entry.dataKey ?? i} className="flex items-center gap-2 text-body-2-medium text-text-primary">
            <span
              aria-hidden
              className={cx('shrink-0', indicator === 'dot' ? 'size-2 rounded-full' : 'h-3 w-0.5 rounded-full')}
              style={{ backgroundColor: entry.color }}
            />
            <span className="min-w-0 flex-1 truncate text-text-secondary">{entry.name}</span>
            <span className="tabular-nums">{entry.value != null ? valueFormatter(entry.value) : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const AreaChart = Object.assign(AreaChartRoot, {
  Grid: AreaChartGrid,
  XAxis: AreaChartXAxis,
  YAxis: AreaChartYAxis,
  Area: AreaChartArea,
  Tooltip: AreaChartTooltip,
  TooltipContent: AreaChartTooltipContent,
})
