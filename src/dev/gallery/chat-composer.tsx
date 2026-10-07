import { useState } from 'react'

import { Tooltip, TooltipTrigger } from '@/components/base'
import { AttachmentTiles } from '@/components/chat/attachment-tiles'
import { Composer } from '@/components/chat/composer'
import { ComposerMenu } from '@/components/chat/composer-menu'
import { ComposerStatusTab } from '@/components/chat/composer-status-tab'
import { ModeChip } from '@/components/chat/mode-chip'
import { ModelPanel } from '@/components/chat/model-panel'
import { PromptQueue } from '@/components/chat/prompt-queue'
import { StickerGrid } from '@/components/chat/sticker-grid'
import { TodoProgressChip } from '@/components/chat/todo-progress-chip'
import { VoiceButton, type VoiceButtonState } from '@/components/ui/voice-button'
import { cx } from '@/utils/cx'
import type { ChatMode, ThinkingLevel } from '@/types'
import { PG_STICKERS, TODO_NO_CURRENT, TODO_RUNNING, TODO_SINGLE, caps, noop, queued } from './fixtures'
import { Section } from './shell'

/**
 * The `+` menu and the mode chip beside it, with nothing behind them:
 * `providers` is empty, so the model row opens an empty column instead of
 * fetching. The line underneath is what the two settings the chip writes are
 * now, so a choice can be checked against what got stored.
 */
function ComposerMenuCase({
  label,
  mode: initialMode,
  acceptEdits: initialAcceptEdits,
}: {
  label: string
  mode: ChatMode
  acceptEdits: boolean
}) {
  const [mode, setMode] = useState<ChatMode>(initialMode)
  const [acceptEdits, setAcceptEdits] = useState(initialAcceptEdits)
  const [thinking, setThinking] = useState<ThinkingLevel>('default')
  const [fast, setFast] = useState(false)
  return (
    <div data-slot="composer-menu-case" className="flex flex-col gap-1">
      <span data-slot="composer-menu-case-label" className="text-caption-1-regular text-text-secondary">
        {label}
      </span>
      <div
        data-slot="composer-menu-case-frame"
        className="flex items-center rounded-lg border border-border-button-default px-2 py-1"
      >
        <ComposerMenu onPickFile={() => {}} onOpenStickers={() => {}} />
        <ModeChip mode={mode} acceptEdits={acceptEdits} onSelectMode={setMode} onToggleAcceptEdits={setAcceptEdits} />
        <span className="ms-auto" />
        <ModelPanel
          assistants={[]}
          providers={[]}
          currentAssistantId={null}
          currentModelId="gpt-5.6-sol"
          currentProviderId={null}
          onSelectAssistant={() => {}}
          onSelectModel={() => {}}
          thinkingLevel={thinking}
          onSelectThinkingLevel={setThinking}
          fastMode={fast}
          onToggleFast={setFast}
          capabilities={caps({ supports_fast: true })}
        />
      </div>
      <span data-slot="composer-menu-case-state" className="text-caption-1-regular text-text-secondary">
        {mode} · {acceptEdits ? 'accept-edits' : 'ask'} · {thinking} · {fast ? 'fast' : 'normal'}
      </span>
    </div>
  )
}

/**
 * Attachment tiles that can be reordered and removed, so a drag — by pointer,
 * or from a number with the keyboard — can be tried and its order read off
 * the list underneath.
 */
function AttachmentTilesCase() {
  const [files, setFiles] = useState(() => [
    { name: 'design-notes.md' },
    { name: 'report-final-final.pdf' },
    { name: 'schema.sql' },
    { name: 'missing-since-draft.txt', missing: true },
  ])
  return (
    <div className="flex max-w-md flex-col gap-2">
      <div className="rounded-3xl border border-border-button-default bg-background-primary-default px-2 pt-2">
        <AttachmentTiles
          files={files}
          onReorder={setFiles}
          onRemove={(index) => setFiles((current) => current.filter((_, i) => i !== index))}
        />
      </div>
      <p data-slot="gallery-attachment-order" className="text-caption-1-regular text-text-secondary">
        {files.map((file) => file.name).join(' → ')}
      </p>
    </div>
  )
}

export default function ChatComposer() {
  return (
    <>
      <Section title="ComposerMenu / 输入框选项菜单">
        <div data-slot="gallery-composer-menus" className="flex flex-wrap items-center gap-4">
          <ComposerMenuCase label="默认" mode="work" acceptEdits={false} />
          <ComposerMenuCase label="自动接受编辑" mode="work" acceptEdits />
          <ComposerMenuCase label="谋定" mode="plan" acceptEdits={false} />
        </div>
      </Section>
      <Section title="StickerGrid / 贴纸选择器网格">
        <div data-slot="gallery-sticker-grids" className="flex flex-wrap items-start gap-4">
          {(['w-[24rem]', 'w-[20rem]'] as const).map((width) => (
            <div
              key={width}
              data-slot="gallery-sticker-grid"
              className={cx(
                '@container/stickers rounded-2xl border border-border-button-default bg-background-primary-default',
                width,
              )}
            >
              <StickerGrid items={PG_STICKERS} loading={false} empty={null} onAction={noop} />
            </div>
          ))}
        </div>
      </Section>
      <Section title="AttachmentTiles / 附件方块">
        <div data-slot="gallery-attachment-tiles">
          <AttachmentTilesCase />
        </div>
      </Section>
      <Section title="ComposerStatusTab / 输入框状态页签">
        {/* The tab over a composer card: a checklist under way, one with a
              single step, one with nothing in progress. The chip opens the
              whole list. The usage reading needs a live conversation and is
              photographed in the demo transcript instead. */}
        <div data-slot="gallery-status-tabs" className="flex max-w-2xl flex-col gap-4">
          {[TODO_RUNNING, TODO_SINGLE, TODO_NO_CURRENT].map((todos) => (
            <Composer
              key={todos}
              value=""
              onChange={() => {}}
              onSubmit={() => {}}
              ariaLabel="status tab probe"
              placeholder="发送消息…"
              status={<ComposerStatusTab progress={<TodoProgressChip todos={JSON.parse(todos)} />} />}
            />
          ))}
        </div>
      </Section>
      <Section title="PromptQueue / 插队与做完再说">
        {/* The queue is a child of PromptInput, which is the composer's
              card. Two modes in one list: a follow-up is a sibling of the
              current run, an interjection hangs off it with ↳. */}
        <Composer
          value=""
          onChange={() => {}}
          onSubmit={() => {}}
          streaming
          steerable
          placeholder="排队接下来要做的事…"
          ariaLabel="queue probe"
          queue={
            <PromptQueue
              currentTodos={JSON.parse(TODO_RUNNING)}
              streaming
              held={false}
              items={[
                queued('later', 'follow_up', '做完再说：补一条测试'),
                queued('now', 'interject', '插队：先停在这一步'),
              ]}
              onRemove={() => {}}
              onReorder={() => {}}
              onSetDelivery={() => {}}
              onRelease={() => {}}
            />
          }
        />
      </Section>
      <Section title="VoiceButton / 语音输入按钮">
        <div data-slot="gallery-voice-buttons" className="flex flex-wrap items-center gap-6">
          {(['idle', 'recording-hold', 'recording-toggle', 'transcribing'] as VoiceButtonState[]).map((s) => (
            <div data-slot="gallery-voice-button" key={s} className="flex flex-col items-center gap-1">
              <TooltipTrigger delay={0}>
                <VoiceButton aria-label="语音输入" state={s} elapsed={s.startsWith('recording') ? 12.4 : 0} />
                <Tooltip>语音输入</Tooltip>
              </TooltipTrigger>
              <span data-slot="gallery-voice-button-state" className="text-caption-1-regular text-text-secondary">
                {s}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}
