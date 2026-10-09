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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import { PromptInput, Segment } from '@/components/base'
import { useSendMessage } from '@/hooks/use-send-message'
import { useTurnSettings } from '@/hooks/use-turn-settings'
import { useBoardStore } from '@/stores/board-store'
import { useConversationStore } from '@/stores/conversation-store'
import type { BoardAgentKind, BoardTaskInfoResponse } from '@/types'
import type { AgentState } from './agent-state'

function ComposerField({
  value,
  setValue,
  placeholder,
  running,
  onSend,
  onStop,
}: {
  value: string
  setValue: (value: string) => void
  placeholder: string
  running: boolean
  onSend: (text: string) => void
  onStop?: () => void
}) {
  const { t } = useTranslation()
  return (
    <PromptInput
      value={value}
      onValueChange={setValue}
      onSubmit={() => onSend(value.trim())}
      onStop={running ? onStop : undefined}
      status={running ? 'streaming' : 'ready'}
      lockInputOnRun={false}
      allowSubmitWhileRunning
      maxLines={4}
    >
      {/* The chat composer's shell goes transparent while a turn runs, because
          the loader draws the surface there. A card has no loader, so it keeps
          its edge. */}
      <PromptInput.Shell className="flex items-end gap-1 rounded-2xl border-border-button-default bg-background-primary-default pr-1 shadow-xs">
        {/* The field's own padding and type, untouched: its placeholder is drawn over it at those offsets. */}
        <div className="min-w-0 flex-1">
          <PromptInput.TextArea aria-label={t('board.composer.label')} placeholder={placeholder} />
        </div>
        <PromptInput.Send sendLabel={t('board.composer.send')} stopLabel={t('board.composer.stop')} className="mb-1" />
      </PromptInput.Shell>
    </PromptInput>
  )
}

/** A card that has not started: choose the agent, and the first message starts it. */
export function StartComposer({ task, onError }: { task: BoardTaskInfoResponse; onError: (error: string) => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const agentKind = useBoardStore((s) => s.agentKind)
  const setAgentKind = useBoardStore((s) => s.setAgentKind)

  const start = async (text: string) => {
    try {
      const started = await api.boardTaskStart({ id: task.id, agentKind })
      // The first message is what was asked, and the board's note about the
      // worktree: detached, the branch and its base the agent's to choose.
      const asked = text || task.request || task.title
      await api.queueEnqueue({
        conversationId: started.conversation.id,
        content: `${asked}\n\n${t('board.agentNote')}`,
        delivery: 'follow_up',
        contextRefs: null,
        conversationRefs: null,
      })
      setValue('')
      await useBoardStore.getState().load()
    } catch (err) {
      onError(t('board.error.start', { error: String(err) }))
    }
  }

  return (
    <div data-slot="board-start" className="flex flex-col gap-2">
      <Segment
        aria-label={t('board.agent.label')}
        size="sm"
        selectedKey={agentKind}
        onSelectionChange={(next) => {
          if (next === 'native' || next === 'claude_code') setAgentKind(next as BoardAgentKind)
        }}
        className="w-fit"
      >
        <Segment.Item id="native">{t('board.agent.native')}</Segment.Item>
        <Segment.Item id="claude_code">{t('board.agent.claudeCode')}</Segment.Item>
      </Segment>
      <ComposerField
        value={value}
        setValue={setValue}
        placeholder={t('board.composer.idle')}
        running={false}
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
  const [value, setValue] = useState('')
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
        await api.queueEnqueue({
          conversationId,
          content: text,
          delivery: 'follow_up',
          contextRefs: null,
          conversationRefs: null,
        })
      } else {
        // Telling a card under review to keep working is the person moving it.
        if (task.stage === 'review') {
          // At the end of the column: the backend's index is a u32, and "past the end" is "append".
          const end = useBoardStore.getState().tasks.filter((card) => card.stage === 'running').length
          await api.boardTaskMove({ id: task.id, stage: 'running', index: end })
        }
        await sendMessage(text, true)
      }
      setValue('')
    } catch (err) {
      onError(t('board.error.send', { error: String(err) }))
    }
  }

  const stop = () => {
    const failed = (err: unknown) => onError(t('board.error.send', { error: String(err) }))
    if (task.agent_kind === 'claude_code') {
      api.acpCancel(conversationId).catch(failed)
      return
    }
    const turnId = useConversationStore.getState().sessions[conversationId]?.activeTurnId ?? null
    api.stopChat({ conversationId, turnId }).catch(failed)
  }

  return (
    <ComposerField
      value={value}
      setValue={setValue}
      placeholder={placeholderFor(t, state)}
      running={running}
      onSend={(text) => void send(text)}
      onStop={stop}
    />
  )
}
