// The box at the foot of a card, for saying something to that agent without
// leaving the board — a correction, "keep going" when it claims to be done
// and plainly is not, a note before it starts.
//
// What a message does depends on the agent, and the placeholder says which:
//   not started            → the card starts, and this is its first message
//   a turn running/waiting → queued as a follow-up, as the chat composer does
//                            while a turn runs (an interjection is chosen on
//                            the queued row, never by accident)
//   finished / failed      → a new turn; a card under review goes back to
//                            running, which is the person moving it
// A failed or stopped turn holds its queue; sending a new turn does not
// release it — what was queued behind a failure is the transcript's to decide.
import './card-composer.css'
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { TextArea as AriaTextArea } from 'react-aria-components'
import { ArrowUp } from '@keyline-icons/react/two-tone'
import { Stop } from '@keyline-icons/react/fill'

import { api } from '@/api'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { useSendMessage } from '@/hooks/use-send-message'
import { useTurnSettings } from '@/hooks/use-turn-settings'
import { useBoardStore } from '@/stores/board-store'
import { useConversationStore } from '@/stores/conversation-store'
import type { BoardTaskInfoResponse } from '@/types'
import type { AgentState } from './agent-state'

const STOP_AFTER_SEND_MS = 500

function linesToPixels(style: CSSStyleDeclaration, lines: number): number {
  const lineHeight = Number.parseFloat(style.lineHeight)
  const padding = [style.paddingTop, style.paddingBottom]
    .map((side) => Number.parseFloat(side))
    .filter(Number.isFinite)
    .reduce((sum, side) => sum + side, 0)
  return lines * (Number.isNaN(lineHeight) ? 20 : lineHeight) + padding
}

export function ComposerField({
  value,
  setValue,
  placeholder,
  ariaLabel,
  running,
  maxLines,
  onSend,
  onStop,
  onEscapeEmpty,
}: {
  value: string
  setValue: (value: string) => void
  placeholder: string
  ariaLabel?: string
  running: boolean
  maxLines: number
  onSend: (text: string) => void
  onStop?: () => void
  onEscapeEmpty?: () => void
}) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sentAt = useRef(Number.NEGATIVE_INFINITY)

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      const ceiling = linesToPixels(getComputedStyle(el), maxLines)
      const next = Math.min(el.scrollHeight, ceiling)
      el.style.height = `${next}px`
      el.style.overflowY = el.scrollHeight > ceiling ? 'auto' : 'hidden'
    }
    fit()
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value, maxLines])

  const mode: 'send' | 'stop' = running && value.trim() === '' && onStop ? 'stop' : 'send'

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && value === '' && onEscapeEmpty) {
      e.preventDefault()
      onEscapeEmpty()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSend(value.trim())
    }
  }

  return (
    <div data-slot="board-composer" className="m-board-composer">
      <AriaTextArea
        ref={textareaRef}
        rows={1}
        aria-label={ariaLabel ?? t('board.composer.label')}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="m-board-composer__input"
      />
      <span className="m-board-composer__action">
        <Button
          size="sm"
          variant={mode === 'stop' ? 'secondary' : 'primary'}
          icon={mode === 'stop' ? <Stop /> : <ArrowUp />}
          aria-label={mode === 'stop' ? t('board.composer.stop') : t('board.composer.send')}
          onPress={() => {
            if (mode === 'send') {
              sentAt.current = performance.now()
              onSend(value.trim())
            } else if (performance.now() - sentAt.current >= STOP_AFTER_SEND_MS) {
              onStop?.()
            }
          }}
        />
      </span>
    </div>
  )
}

/** A card that has not started: choose the agent, and the first message starts it. */
export function StartComposer({ task, onError }: { task: BoardTaskInfoResponse; onError: (error: string) => void }) {
  const { t } = useTranslation()
  const value = useBoardStore((s) => s.composerText[task.id] ?? '')
  const setComposerText = useBoardStore((s) => s.setComposerText)
  const agentKind = useBoardStore((s) => s.agentKind)
  const setAgentKind = useBoardStore((s) => s.setAgentKind)

  const start = async (text: string) => {
    try {
      const started = await api.board.startTask({ id: task.id, agent_kind: agentKind })
      // The first message is what was asked, and the board's note about the
      // worktree: detached, the branch and its base the agent's to choose.
      const asked = text || task.request || task.title
      await api.queue.create({
        conversation_id: started.conversation.id,
        content: `${asked}\n\n${t('board.agentNote')}`,
        delivery: 'follow_up',
        context_refs: null,
        conversation_refs: null,
      })
      setComposerText(task.id, '')
      await useBoardStore.getState().load()
    } catch (err) {
      onError(t('board.error.start', { error: String(err) }))
    }
  }

  return (
    <div data-slot="board-start" className="m-board-start">
      <div className="m-board-start__agent">
        <SegmentedControl
          aria-label={t('board.agent.label')}
          size="sm"
          selectedKey={agentKind}
          onSelectionChange={(next) => {
            if (next === 'native' || next === 'claude_code') setAgentKind(next)
          }}
        >
          <Segment id="native">{t('board.agent.native')}</Segment>
          <Segment id="claude_code">{t('board.agent.claudeCode')}</Segment>
        </SegmentedControl>
      </div>
      <ComposerField
        value={value}
        setValue={(next) => setComposerText(task.id, next)}
        placeholder={t('board.composer.idle')}
        running={false}
        maxLines={4}
        onSend={(text) => void start(text)}
      />
    </div>
  )
}

function placeholderFor(t: ReturnType<typeof useTranslation>['t'], state: AgentState): string {
  switch (state.kind) {
    case 'working':
    case 'approval':
    case 'question':
      return t('board.composer.queued')
    case 'failed':
      return t('board.composer.failed')
    case 'idle':
    case 'finished':
      return t('board.composer.finished')
  }
}

/** A started card: queue behind a running turn, or start the next one. */
export function ConversationComposer({
  task,
  conversationId,
  state,
  onError,
}: {
  task: BoardTaskInfoResponse
  conversationId: string
  state: AgentState
  onError: (error: string) => void
}) {
  const { t } = useTranslation()
  const value = useBoardStore((s) => s.composerText[task.id] ?? '')
  const setComposerText = useBoardStore((s) => s.setComposerText)
  const streaming = useConversationStore((s) => s.sessions[conversationId]?.streaming ?? false)
  const settings = useTurnSettings(conversationId)
  const { sendMessage } = useSendMessage(conversationId, {
    streaming,
    selectedAssistantId: settings.selectedAssistantId,
    selectedModelId: settings.selectedModelId,
    selectedProviderId: settings.selectedProviderId,
    thinkingLevel: settings.thinkingLevel,
    fastMode: settings.fastMode,
    mode: settings.mode,
  })
  const running = streaming || state.kind === 'working' || state.kind === 'approval' || state.kind === 'question'

  const send = async (text: string) => {
    if (!text) return
    try {
      if (running) {
        await api.queue.create({
          conversation_id: conversationId,
          content: text,
          delivery: 'follow_up',
          context_refs: null,
          conversation_refs: null,
        })
      } else {
        // Telling a card under review to keep working is the person moving it.
        if (task.stage === 'review') {
          // At the end of the column: the backend's index is a u32, and "past the end" is "append".
          const end = useBoardStore.getState().tasks.filter((card) => card.stage === 'running').length
          await api.board.updateTask({ id: task.id, position: { stage: 'running', index: end } })
        }
        await sendMessage(text, true)
      }
      setComposerText(task.id, '')
    } catch (err) {
      onError(t('board.error.send', { error: String(err) }))
    }
  }

  const stop = () => {
    const failed = (err: unknown) => onError(t('board.error.send', { error: String(err) }))
    if (task.agent_kind === 'claude_code') {
      api.acp.stopTurn({ conversation_id: conversationId }).catch(failed)
      return
    }
    const turnId = useConversationStore.getState().sessions[conversationId]?.activeTurnId ?? null
    api.chat.stop({ conversation_id: conversationId, turn_id: turnId }).catch(failed)
  }

  return (
    <ComposerField
      value={value}
      setValue={(next) => setComposerText(task.id, next)}
      placeholder={placeholderFor(t, state)}
      running={running}
      maxLines={4}
      onSend={(text) => void send(text)}
      onStop={stop}
    />
  )
}
