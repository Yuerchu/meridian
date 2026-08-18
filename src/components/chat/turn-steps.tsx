import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { MarkdownContent } from './markdown-content'
import { ToolCallBlock } from './tool-call-block'
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtTrigger } from '@heroui-pro/react/chain-of-thought'
import { markQueued, type TurnStep } from '@/lib/turns'
import { StickerImage, type EmojiMap } from './emoji-renderer'

const MemoToolCallBlock = React.memo(ToolCallBlock)

export interface TurnStepsProps {
  steps: TurnStep[]
  isOneBot?: boolean
  emojiMap?: EmojiMap
  className?: string
}

/**
 * The inside of a collapsed turn.
 *
 * Tool calls keep their full cards — the steps are the reason someone expanded
 * this. Narration between them is dimmed instead: it was written to be read in
 * passing, and at full weight it competes with the answer above.
 */
export function TurnSteps({ steps, isOneBot, emojiMap, className }: TurnStepsProps) {
  const { t } = useTranslation()

  // A turn's steps are already in dispatch order, across every iteration of the
  // loop, so position is all this needs.
  const queued = React.useMemo(() => markQueued(steps.map((s) => (s.kind === 'tool' ? s.data.status : null))), [steps])

  // Spacing comes from gap, not space-y: the tool cards are handed `my-0` to
  // drop their own margins, and Tailwind v4's space-y wraps its selector in
  // `:where()`, so a plain `my-0` outranks it and the cards end up flush.
  return (
    <div data-slot="turn-steps" className={cn('flex flex-col gap-3', className)}>
      {steps.map((step, i) => {
        const key = `${step.messageId}:${step.blockIndex}:${i}`
        if (step.kind === 'thinking') {
          return (
            <ChainOfThought key={key}>
              <ChainOfThoughtTrigger>{t('chat.thinking')}</ChainOfThoughtTrigger>
              <ChainOfThoughtContent className="text-xs text-muted leading-relaxed whitespace-pre-wrap">
                {step.text}
              </ChainOfThoughtContent>
            </ChainOfThought>
          )
        }
        if (step.kind === 'text') {
          if (!step.text.trim()) return null
          return (
            <div key={key} data-slot="turn-step-text" className="text-xs text-muted">
              <MarkdownContent content={step.text} oneBot={isOneBot} emojiMap={emojiMap} />
            </div>
          )
        }
        if (step.kind === 'sticker') {
          return <StickerImage key={key} stickerId={step.stickerId} name={step.name} />
        }
        return <MemoToolCallBlock key={key} data={step.data} queued={queued[i]} className="my-0" />
      })}
    </div>
  )
}
