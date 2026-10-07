import { useState } from 'react'
import { Copy, List, Pen, RefreshCw } from '@keyline-icons/react/two-tone'
import { PromptInput, Switch } from '@/components/base'
import { ComposerLoader } from '@/components/application/composer-loader/composer-loader'
import { ShimmerText } from '@/components/application/agent-log/agent-log'
import { ActionButton } from '@/components/ui/action-button'
import { Bubble, BubbleContent, BubbleTime } from '@/components/ui/bubble'
import { BubbleBlockButton, BubbleFoldBadge } from '@/components/ui/bubble-block'
import { CopyButton } from '@/components/ui/copy-button'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import {
  MessageGroupAssistant,
  MessageGroupAvatar,
  MessageGroupBubbles,
  MessageGroupFooter,
  MessageGroupHeader,
  MessageGroupUser,
} from '@/components/ui/message-group'
import { ToolTextResult, ToolValue } from '@/components/ui/tool-value'
import { TurnBranchPager, TurnStatusIcon } from '@/components/ui/turn-status'
import type { TurnStatus } from '@/lib/turns'
import { Section } from './shell'

const STATUSES: TurnStatus[] = ['streaming', 'complete', 'interrupted', 'crashed', 'empty']

function noop() {}

function MessageGroups() {
  return (
    <div className="flex max-w-2xl flex-col gap-6 rounded-3xl bg-background-secondary-default p-4">
      <MessageGroupUser>
        <Bubble align="end" variant="user">
          <BubbleContent>把鉴权改走 middleware，先别动 handler。</BubbleContent>
        </Bubble>
        <MessageGroupFooter className="gap-1">
          <CopyButton text="把鉴权改走 middleware，先别动 handler。" />
          <ActionButton label="编辑" icon={Pen} onClick={noop} />
        </MessageGroupFooter>
      </MessageGroupUser>
      <MessageGroupAssistant>
        <MessageGroupAvatar>
          <span className="flex size-7 items-center justify-center rounded-full bg-background-tertiary-default text-caption-1-medium">
            M
          </span>
        </MessageGroupAvatar>
        <MessageGroupBubbles>
          <MessageGroupHeader>claude-sonnet-5</MessageGroupHeader>
          <Bubble variant="assistant" position="first">
            <BubbleBlockButton state="output-available" onClick={noop}>
              <List aria-hidden className="size-3.5 shrink-0" />
              <span className="text-caption-1-medium">计划 · 第 3 版</span>
            </BubbleBlockButton>
            <BubbleFoldBadge expanded={false} onClick={noop}>
              读取 4 个文件
            </BubbleFoldBadge>
          </Bubble>
          <Bubble variant="assistant" position="last">
            <BubbleContent>
              改好了，三个路由都挂在同一个 layer 上。 <BubbleTime dateTime="2026-10-07T14:02">14:02</BubbleTime>
            </BubbleContent>
          </Bubble>
          <MessageGroupFooter className="gap-1">
            <ActionButton label="复制" icon={Copy} onClick={noop} />
            <ActionButton label="重新生成" icon={RefreshCw} onClick={noop} />
            <TurnBranchPager
              index={2}
              total={3}
              onPrevious={noop}
              onNext={noop}
              previousLabel="上一版"
              nextLabel="下一版"
            />
          </MessageGroupFooter>
        </MessageGroupBubbles>
      </MessageGroupAssistant>
    </div>
  )
}

function Prompt() {
  const [value, setValue] = useState('')
  const [lit, setLit] = useState(true)
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <PromptInput value={value} onValueChange={setValue} onSubmit={() => setValue('')} status="ready">
        <ComposerLoader active={lit} radius={24}>
          <PromptInput.Shell>
            <PromptInput.Content>
              <PromptInput.TextArea placeholder="发送消息…" aria-label="prompt input probe" />
            </PromptInput.Content>
            <PromptInput.Toolbar>
              <PromptInput.ToolbarStart />
              <PromptInput.ToolbarEnd>
                <PromptInput.Send />
              </PromptInput.ToolbarEnd>
            </PromptInput.Toolbar>
          </PromptInput.Shell>
        </ComposerLoader>
      </PromptInput>
      <Switch isSelected={lit} onChange={setLit}>
        ComposerLoader 亮着
      </Switch>
    </div>
  )
}

export default function ChatParts() {
  return (
    <>
      <Section title="MessageGroup · Bubble 部件 · ActionButton · CopyButton · TurnBranchPager">
        <MessageGroups />
      </Section>
      <Section title="TurnStatusIcon / 回合状态">
        <div className="flex flex-wrap items-center gap-4">
          {STATUSES.map((status) => (
            <span key={status} className="flex items-center gap-1.5 text-body-2-regular text-text-secondary">
              <TurnStatusIcon status={status} />
              {status}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Marker / 时间线标记">
        <div className="flex max-w-xl flex-col gap-4">
          {(['default', 'separator', 'border'] as const).map((variant) => (
            <Marker key={variant} variant={variant}>
              <MarkerIcon>
                <List />
              </MarkerIcon>
              <MarkerContent>已压缩 12 条消息 · {variant}</MarkerContent>
            </Marker>
          ))}
        </div>
      </Section>
      <Section title="ShimmerText / 进行中的文字">
        <ShimmerText>正在读取 src/components/chat/composer.tsx</ShimmerText>
      </Section>
      <Section title="ToolValue · ToolTextResult / 工具参数与结果">
        <div className="grid max-w-3xl gap-3 lg:grid-cols-2">
          <ToolValue
            value={{
              path: 'src/api.ts',
              line: 42,
              recursive: true,
              globs: ['*.ts', '*.tsx'],
              matches: [
                { file: 'a.ts', count: 3 },
                { file: 'b.ts', count: 1 },
              ],
            }}
          />
          <ToolTextResult text={'error[E0425]: cannot find value `pool` in this scope\n  --> src/db.rs:12:5'} />
        </div>
      </Section>
      <Section title="PromptInput · ComposerLoader / 输入框底座">
        <Prompt />
      </Section>
    </>
  )
}
