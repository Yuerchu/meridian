import type { ReactNode } from 'react'
import { ProjectBranchChip } from '@/components/chat/composer-status-tab'
import { PlanReviewEntryView, type CardUi } from '@/components/chat/plan-review-entry'
import { Bubble } from '@/components/ui/bubble'
import { ChatToolPresentationProvider } from '@/components/ui/chat-tool'
import type { PlanCardPreview } from '@/lib/plan-card'
import type { PlanReviewStatus } from '@/types'
import { Section } from './shell'

const PREVIEW: PlanCardPreview = {
  revisionNo: 3,
  excerpt: {
    title: '鉴权改走 middleware',
    lines: [
      '1. 抽出 verify_token，handler 只拿解析后的 claims',
      '2. 三个路由改用 layer 挂载',
      '3. 补过期与伪造两类测试',
    ],
  },
}

interface PlanCase {
  label: string
  status: PlanReviewStatus
  ui: CardUi
  note?: string
  preview?: PlanCardPreview | null
}

/** Every step a press on the card can lead to, plus a settled plan and one whose preview read failed. */
const PLAN_CASES: PlanCase[] = [
  { label: '待审阅 · 带摘录', status: 'pending', ui: { step: 'idle' } },
  { label: '写退回意见', status: 'pending', ui: { step: 'feedback' }, note: '先别动 handler.rs，只加测试。' },
  { label: '决定中', status: 'pending', ui: { step: 'deciding' } },
  { label: '草稿进行中（只能去评审页）', status: 'pending', ui: { step: 'draft' } },
  { label: '出错', status: 'pending', ui: { step: 'error', message: '草稿已被另一处修改（generation 4 ≠ 3）。' } },
  { label: '摘录读取失败', status: 'pending', ui: { step: 'idle' }, preview: null },
  { label: '已批准', status: 'approved', ui: { step: 'idle' } },
  { label: '已退回', status: 'changes_requested', ui: { step: 'idle' } },
]

function noop() {}

function PlanCards({ presentation }: { presentation: 'card' | 'bubble' }) {
  return (
    <ChatToolPresentationProvider value={presentation}>
      <div className="grid gap-4 lg:grid-cols-2">
        {PLAN_CASES.map((c) => {
          const view = (
            <PlanReviewEntryView
              status={c.status}
              preview={c.preview === undefined ? PREVIEW : c.preview}
              ui={c.ui}
              note={c.note ?? ''}
              onNoteChange={noop}
              onUiChange={noop}
              onOpen={noop}
              onApprove={noop}
              onSendBack={noop}
            />
          )
          return (
            <Labelled key={c.label} label={c.label}>
              {presentation === 'bubble' ? (
                <Bubble variant="assistant" className="w-full max-w-full">
                  {view}
                </Bubble>
              ) : (
                view
              )}
            </Labelled>
          )
        })}
      </div>
    </ChatToolPresentationProvider>
  )
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-caption-1-medium text-text-secondary">{label}</span>
      {children}
    </div>
  )
}

export function PlanCardSections() {
  return (
    <>
      <Section title="PlanReviewEntry / 计划卡 · 气泡内">
        <div data-slot="gallery-plan-cards-bubble">
          <PlanCards presentation="bubble" />
        </div>
      </Section>
      <Section title="PlanReviewEntry / 计划卡 · 卡片">
        <div data-slot="gallery-plan-cards-card">
          <PlanCards presentation="card" />
        </div>
      </Section>
    </>
  )
}

export function BranchChipSection() {
  return (
    <Section title="ProjectBranchChip / 当前分支">
      <div data-slot="gallery-branch-chips" className="flex max-w-md flex-col items-start gap-2">
        <ProjectBranchChip branch={{ status: 'branch', name: 'feat/design-parity-chat' }} />
        <ProjectBranchChip branch={{ status: 'detached' }} />
        <ProjectBranchChip
          branch={{ status: 'branch', name: 'feat/a-branch-name-long-enough-to-hit-the-max-width-and-truncate' }}
        />
      </div>
    </Section>
  )
}
