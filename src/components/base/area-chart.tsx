import {
  AreaChart as RechartsAreaChart,
  Area as RechartsArea,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  type XAxisProps,
  type YAxisProps,
  type CartesianGridProps,
} from 'recharts'
import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface AreaChartRootProps extends ComponentProps<'div'> {
  data?: Record<string, unknown>[]
  height?: number
}

function AreaChartRoot({ data, height = 200, children, className, ...props }: AreaChartRootProps) {
  return (
    <div data-slot="area-chart" {...props} className={cx('', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsAreaChart data={data}>{children}</RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function AreaChartGrid(props: CartesianGridProps) {
  return (
    <CartesianGrid
      data-slot="area-chart-grid"
      strokeDasharray="3 3"
      stroke="var(--color-separator-border)"
      {...props}
    />
  )
}

function AreaChartXAxis(props: XAxisProps) {
  return <RechartsXAxis data-slot="area-chart-x-axis" stroke="var(--color-text-secondary)" fontSize={12} {...props} />
}

function AreaChartYAxis(props: YAxisProps) {
  return <RechartsYAxis data-slot="area-chart-y-axis" stroke="var(--color-text-secondary)" fontSize={12} {...props} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts generic types
function AreaChartArea(props: any) {
  return <RechartsArea data-slot="area-chart-area" type="monotone" {...props} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts generic types
function AreaChartTooltip(props: any) {
  return <RechartsTooltip data-slot="area-chart-tooltip" {...props} />
}

interface AreaChartTooltipContentProps {
  indicator?: 'line' | 'dot'
  valueFormatter?: (value: string | number) => string
  className?: string
}

function AreaChartTooltipContent({ className }: AreaChartTooltipContentProps) {
  return (
    <div
      data-slot="area-chart-tooltip-content"
      className={cx(
        'rounded-lg border border-border-button-default bg-background-primary-default p-2 shadow-dropdown',
        className,
      )}
    />
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
