import {
  ActivityHeatmap,
  AreaChart,
  BarChart,
  BarList,
  ChartCard,
  ChartLegend,
  DonutChart,
  KPI,
  type BarListItem,
  type DonutChartItem,
} from '@/components/base'
import { Section } from './shell'

const DAYS = ['10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07']

const USAGE = DAYS.map((day, i) => ({
  day,
  input: 120_000 + ((i * 53_000) % 180_000),
  output: 12_000 + ((i * 7_000) % 30_000),
  cache: 60_000 + ((i * 41_000) % 140_000),
}))

const BANDS = [
  { key: 'input', label: '输入', color: 'var(--color-chart-1)' },
  { key: 'cache', label: '缓存', color: 'var(--color-chart-2)' },
  { key: 'output', label: '输出', color: 'var(--color-chart-3)' },
] as const

const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact' })
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 })

const RANKED: BarListItem[] = [
  { key: 'sonnet', label: 'claude-sonnet-5', value: '842万', width: '100%', share: '61%' },
  { key: 'gpt', label: 'gpt-5.1', value: '311万', width: '37%', share: '22%' },
  { key: 'qwen', label: 'qwen3-coder（本地）', value: '196万', width: '23%', share: '14%' },
  { key: 'flash', label: 'gemini-3-flash', value: '41万', width: '5%', share: '3%' },
]

const MIX: DonutChartItem[] = [
  { key: 'cache', label: '缓存读取', value: 9_120_000, color: 'var(--color-chart-2)' },
  { key: 'input', label: '输入', value: 4_310_000, color: 'var(--color-chart-1)' },
  { key: 'output', label: '输出', value: 862_000, color: 'var(--color-chart-3)' },
]

/** One part far under 1%: its arc is shorter than its own caps, so it draws as a dot. */
const MIX_TINY: DonutChartItem[] = [
  { key: 'input', label: '输入', value: 9_990_000, color: 'var(--color-chart-1)' },
  { key: 'reasoning', label: '推理', value: 4_000, color: 'var(--color-chart-4)' },
]

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const HOURS = 24
const EMPTY_GRID = WEEKDAYS.map(() => Array.from({ length: HOURS }, () => 0))
const FULL_GRID = WEEKDAYS.map((_, row) =>
  Array.from({ length: HOURS }, (_, hour) => {
    const working = hour >= 9 && hour <= 23 ? 6 + ((row * 7 + hour * 3) % 18) : (hour * row) % 3
    return row >= 5 ? Math.floor(working / 2) : working
  }),
)

function Heatmap({ data }: { data: number[][] }) {
  return (
    <ActivityHeatmap
      data={data}
      rowLabels={WEEKDAYS}
      columnLabel={(hour) => (hour % 6 === 0 ? `${hour}时` : '')}
      caption={(row, hour, value) => `周${WEEKDAYS[row]} ${hour}:00 · ${value} 条回复`}
      less="少"
      more="多"
      aria-label="使用时段"
    />
  )
}

function StackedBars({ bands }: { bands: readonly (typeof BANDS)[number][] }) {
  return (
    <BarChart data={USAGE} height={200}>
      <BarChart.Grid vertical={false} />
      <BarChart.XAxis dataKey="day" tickMargin={8} />
      <BarChart.YAxis width={44} tickFormatter={(v: number) => compact.format(v)} />
      {bands.map((band, i) => (
        <BarChart.Bar
          key={band.key}
          dataKey={band.key}
          fill={band.color}
          name={band.label}
          stackId="tokens"
          radius={i === bands.length - 1 ? [4, 4, 0, 0] : 0}
        />
      ))}
      <BarChart.Tooltip
        content={<BarChart.TooltipContent indicator="dot" valueFormatter={(v) => compact.format(Number(v))} />}
      />
    </BarChart>
  )
}

export default function Charts() {
  const legend = BANDS.map((band) => ({ key: band.key, color: band.color, label: band.label }))
  return (
    <>
      <Section title="KPI">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['花费', '¥12.48'],
            ['输入', '1514.9万'],
            ['输出', '86.2万'],
          ].map(([title, value]) => (
            <KPI key={title}>
              <KPI.Header>
                <KPI.Title>{title}</KPI.Title>
              </KPI.Header>
              <KPI.Content>
                <KPI.Value>{value}</KPI.Value>
              </KPI.Content>
            </KPI>
          ))}
        </div>
      </Section>
      <Section title="ChartCard · ChartLegend · BarChart（堆叠，只有最上一段带圆角）">
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard title="每日 token" action={<ChartLegend items={legend} />}>
            <StackedBars bands={BANDS} />
          </ChartCard>
          <ChartCard title="只剩一个分段" action={<ChartLegend items={legend.slice(0, 1)} />}>
            <StackedBars bands={BANDS.slice(0, 1)} />
          </ChartCard>
        </div>
      </Section>
      <Section title="BarList">
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard title="按模型 token · 带占比">
            <BarList items={RANKED} aria-label="按模型 token" />
          </ChartCard>
          <ChartCard title="不带占比">
            <BarList items={RANKED.map(({ share: _share, ...item }) => item)} color="var(--color-chart-1)" />
          </ChartCard>
        </div>
      </Section>
      <Section title="DonutChart">
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard title="token 去向">
            <DonutChart
              items={MIX}
              centerValue={compact.format(MIX.reduce((sum, item) => sum + item.value, 0))}
              centerLabel="总计"
              format={(v) => compact.format(v)}
              formatShare={(share) => percent.format(share)}
            />
          </ChartCard>
          <ChartCard title="极小分段画成圆点">
            <DonutChart
              items={MIX_TINY}
              centerValue={compact.format(MIX_TINY.reduce((sum, item) => sum + item.value, 0))}
              centerLabel="总计"
              format={(v) => compact.format(v)}
              formatShare={(share) => percent.format(share)}
            />
          </ChartCard>
        </div>
      </Section>
      <Section title="ActivityHeatmap">
        <div className="grid gap-3">
          <ChartCard title="使用时段 · 有数据">
            <Heatmap data={FULL_GRID} />
          </ChartCard>
          <ChartCard title="使用时段 · 空">
            <Heatmap data={EMPTY_GRID} />
          </ChartCard>
        </div>
      </Section>
      <Section title="AreaChart · 堆叠">
        <div className="rounded-2xl bg-background-primary-default p-4 shadow-card">
          <AreaChart data={USAGE} height={220}>
            <defs>
              {BANDS.map((band) => (
                <linearGradient key={band.key} id={`pg-fill-${band.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={band.color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={band.color} stopOpacity={0.1} />
                </linearGradient>
              ))}
            </defs>
            <AreaChart.Grid vertical={false} />
            <AreaChart.XAxis dataKey="day" tickMargin={8} />
            <AreaChart.YAxis width={44} tickFormatter={(v: number) => compact.format(v)} />
            {BANDS.map((band) => (
              <AreaChart.Area
                key={band.key}
                dataKey={band.key}
                dot={false}
                fill={`url(#pg-fill-${band.key})`}
                name={band.label}
                stackId="tokens"
                stroke={band.color}
                strokeWidth={2}
                type="monotone"
              />
            ))}
            <AreaChart.Tooltip
              content={<AreaChart.TooltipContent indicator="line" valueFormatter={(v) => compact.format(Number(v))} />}
            />
          </AreaChart>
        </div>
      </Section>
    </>
  )
}
