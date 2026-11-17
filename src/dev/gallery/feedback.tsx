import { useState } from 'react'
import { Plug } from '@keyline-icons/react/two-tone'

import { Meter, Skeleton } from '@/components/base'
import { ProgressCircle } from '@/components/yuerchu-ui/components/progress-circle/progress-circle'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Row, Section, Stage } from './shell'

const ALERT_TONES = ['neutral', 'success', 'warning', 'danger'] as const

function Alerts() {
  return (
    <Stage>
      {ALERT_TONES.map((tone) => (
        <Alert key={tone} tone={tone} heading={tone}>
          命令将以完整权限运行。
        </Alert>
      ))}
      <Alert tone="danger">只有描述：无法加载终端、沙箱和网页搜索设置。</Alert>
    </Stage>
  )
}

function Empty() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(['sm', 'md'] as const).map((size) => (
        <Stage key={size} className="items-center">
          <EmptyState
            heading="还没有 MCP 服务器"
            headingLevel={3}
            description={<>添加一个，给智能体更多工具。（{size}）</>}
            icon={<Plug />}
            actions={
              <Button size="sm" variant="secondary">
                添加
              </Button>
            }
            size={size}
          />
        </Stage>
      ))}
    </div>
  )
}

function Progress() {
  const [level, setLevel] = useState(40)
  return (
    <Stage>
      <Row label="ProgressCircle">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <ProgressCircle key={size} size={size} value={62} showValueLabel aria-label={`进度 ${size}`} />
        ))}
        <ProgressCircle isIndeterminate aria-label="正在处理" />
      </Row>
      <Row label="Meter">
        <Meter aria-label="麦克风电平" value={level} className="w-64">
          <Meter.Track className="h-2 rounded-full bg-background-secondary-default">
            <Meter.Fill className="bg-status-success transition-[width] duration-75" />
          </Meter.Track>
        </Meter>
        <Button size="sm" variant="secondary" onPress={() => setLevel((v) => (v + 25) % 125)}>
          变化
        </Button>
      </Row>
    </Stage>
  )
}

function Skeletons() {
  return (
    <Stage>
      <div role="status" aria-busy aria-label="加载中" className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-3/4 rounded-md" />
        <div className="flex gap-3">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-9 flex-1 rounded-2lg" />
        </div>
      </div>
    </Stage>
  )
}

export default function Feedback() {
  return (
    <>
      <Section title="Alert">
        <Alerts />
      </Section>
      <Section title="EmptyState">
        <Empty />
      </Section>
      <Section title="ProgressCircle / Meter">
        <Progress />
      </Section>
      <Section title="Skeleton">
        <Skeletons />
      </Section>
    </>
  )
}
