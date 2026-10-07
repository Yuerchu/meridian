import { useState } from 'react'
import { Plug } from '@keyline-icons/react/two-tone'

import { Alert, Button, EmptyState, Meter, ProgressCircle, Skeleton } from '@/components/base'
import { Row, Section, Stage } from './shell'

const ALERT_STATUSES = ['default', 'info', 'success', 'warning', 'danger'] as const

function Alerts() {
  return (
    <Stage>
      {ALERT_STATUSES.map((status) => (
        <Alert key={status} status={status}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{status}</Alert.Title>
            <Alert.Description>命令将以完整权限运行。</Alert.Description>
          </Alert.Content>
        </Alert>
      ))}
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>只有描述：无法加载终端、沙箱和网页搜索设置。</Alert.Description>
        </Alert.Content>
      </Alert>
    </Stage>
  )
}

function Empty() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <Stage key={size} className="items-center">
          <EmptyState size={size}>
            <EmptyState.Header>
              <EmptyState.Media>
                <Plug />
              </EmptyState.Media>
              <EmptyState.Title>还没有 MCP 服务器</EmptyState.Title>
              <EmptyState.Description>添加一个，给智能体更多工具。（{size}）</EmptyState.Description>
            </EmptyState.Header>
            <EmptyState.Content>
              <Button size="small" variant="secondary">
                添加
              </Button>
            </EmptyState.Content>
          </EmptyState>
        </Stage>
      ))}
    </div>
  )
}

function Progress() {
  const [level, setLevel] = useState(40)
  return (
    <Stage>
      {(['accent', 'neutral', 'success', 'warning', 'danger'] as const).map((color) => (
        <Row key={color} label={color}>
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <ProgressCircle key={size} size={size} color={color} value={62} aria-label={`${color} ${size}`} />
          ))}
          <ProgressCircle color={color} isIndeterminate aria-label={`${color} 不确定`} />
        </Row>
      ))}
      <Row label="Meter">
        <Meter aria-label="麦克风电平" value={level} className="w-64">
          <Meter.Track className="h-2 rounded-full bg-background-secondary-default">
            <Meter.Fill className="bg-status-success transition-[width] duration-75" />
          </Meter.Track>
        </Meter>
        <Button size="xs" variant="secondary" onPress={() => setLevel((v) => (v + 25) % 125)}>
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
