import { BarChart, DonutChart } from '@/components/yuerchu-ui/components/chart/chart'
import { Section, Stage } from './shell'

const DAYS = ['10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07']

const USAGE = DAYS.map((day, i) => ({
  day,
  input: 120_000 + ((i * 53_000) % 180_000),
  output: 12_000 + ((i * 7_000) % 30_000),
  cache: 60_000 + ((i * 41_000) % 140_000),
}))

const BANDS = [
  { key: 'input' as const, label: '输入' },
  { key: 'cache' as const, label: '缓存' },
  { key: 'output' as const, label: '输出' },
]

const MIX = [
  { key: 'cache', label: '缓存读取', value: 9_120_000 },
  { key: 'input', label: '输入', value: 4_310_000 },
  { key: 'output', label: '输出', value: 862_000 },
]

const MIX_TINY = [
  { key: 'input', label: '输入', value: 9_990_000 },
  { key: 'reasoning', label: '推理', value: 4_000 },
]

export default function Charts() {
  return (
    <>
      <Section title="BarChart（库 · 堆叠与单系列）">
        <div className="grid gap-3 lg:grid-cols-2">
          <Stage>
            <BarChart
              heading="每日 token"
              data={USAGE}
              x="day"
              series={BANDS}
              stacked
              height={200}
              showLegend
              valueFormat={{ notation: 'compact', maximumFractionDigits: 1 }}
            />
          </Stage>
          <Stage>
            <BarChart
              heading="只剩一个分段"
              data={USAGE}
              x="day"
              series={BANDS.slice(0, 1)}
              stacked
              height={200}
              showLegend
              valueFormat={{ notation: 'compact', maximumFractionDigits: 1 }}
            />
          </Stage>
        </div>
      </Section>
      <Section title="DonutChart（库）">
        <div className="grid gap-3 lg:grid-cols-2">
          <Stage>
            <DonutChart
              heading="token 去向"
              data={MIX}
              label="label"
              value="value"
              totalLabel="总计"
              valueFormat={{ notation: 'compact', maximumFractionDigits: 1 }}
              height={200}
              showLegend
            />
          </Stage>
          <Stage>
            <DonutChart
              heading="极小分段"
              data={MIX_TINY}
              label="label"
              value="value"
              totalLabel="总计"
              valueFormat={{ notation: 'compact', maximumFractionDigits: 1 }}
              height={200}
              showLegend
            />
          </Stage>
        </div>
      </Section>
    </>
  )
}
