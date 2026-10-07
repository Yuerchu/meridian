import type { ComponentProps } from 'react'
import {
  Bar as RechartsBar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
  type CartesianGridProps,
  type XAxisProps,
  type YAxisProps,
} from 'recharts'
import { AreaChart } from './area-chart'
import { cx } from '@/utils/cx'

/**
 * recharts' bar chart, themed the way `AreaChart` is: hairline dashed grid,
 * axes in secondary text, and the same tooltip panel. Series colours are the
 * caller's (`chart-1..9`).
 *
 * For a stack, give every `Bar` one `stackId` and only the last one a top
 * radius — rounding every segment breaks the column into beads with a gap at
 * each join, which reads as missing data rather than as one total.
 */

interface BarChartRootProps extends ComponentProps<'div'> {
  data?: Record<string, unknown>[]
  height?: number
}

function BarChartRoot({ data, height = 200, children, className, ...props }: BarChartRootProps) {
  return (
    <div data-slot="bar-chart" {...props} className={cx('w-full text-caption-1-medium', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsBarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          {children}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  )
}

function BarChartGrid(props: CartesianGridProps) {
  return <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-button-default)" {...props} />
}

function BarChartXAxis(props: XAxisProps) {
  return (
    <RechartsXAxis
      axisLine={false}
      tickLine={false}
      tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
      {...props}
    />
  )
}

function BarChartYAxis(props: YAxisProps) {
  return (
    <RechartsYAxis
      axisLine={false}
      tickLine={false}
      tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
      {...props}
    />
  )
}

function BarChartBar(props: ComponentProps<typeof RechartsBar>) {
  return <RechartsBar maxBarSize={28} {...props} />
}

function BarChartTooltip(props: ComponentProps<typeof RechartsTooltip>) {
  return <RechartsTooltip cursor={{ fill: 'var(--color-chart-track)', opacity: 0.6 }} {...props} />
}

export const BarChart = Object.assign(BarChartRoot, {
  Grid: BarChartGrid,
  XAxis: BarChartXAxis,
  YAxis: BarChartYAxis,
  Bar: BarChartBar,
  Tooltip: BarChartTooltip,
  TooltipContent: AreaChart.TooltipContent,
})
