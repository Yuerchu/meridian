import { AreaChart, KPI } from '@/components/base'
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

export default function Charts() {
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
