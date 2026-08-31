import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { ChatTranscript } from './chat-transcript'
import { CompactedRegion } from './compacted-region'
import { TranscriptStatus } from './transcript-status'
import { useTurns } from '@/hooks/use-turns'
import { InputBar, type AttachedFile, type PendingSticker } from './input-bar'
import { PromptQueue } from './prompt-queue'
import { TodoBar } from './todo-bar'
import { usePromptQueue } from '@/hooks/use-prompt-queue'
import { useEmojiMap } from './emoji-renderer'
import { useSenderNames } from '@/hooks/use-sender-names'
import { useTurnSettings } from '@/hooks/use-turn-settings'
import { useSendMessage } from '@/hooks/use-send-message'
import { useContextInfo } from '@/hooks/use-context-info'
import { useConversationStore } from '@/stores/conversation-store'
import type { Message, QueueDelivery } from '@/types'

// Stable identity for the empty case: `?? []` would hand useTurns a new array on
// every render of a conversation whose session has not been created yet.
const NO_MESSAGES: Message[] = []

function ChatViewInner({
  conversationId,
  initialMessage,
  onInitialMessageConsumed,
}: {
  conversationId: string
  initialMessage?: string | null
  onInitialMessageConsumed?: () => void
}) {
  const session = useConversationStore((s) => s.sessions[conversationId])
  const storeEnsureSession = useConversationStore((s) => s.ensureSession)
  const storeLoadMessages = useConversationStore((s) => s.loadMessages)
  const storeLoadActiveTodos = useConversationStore((s) => s.loadActiveTodos)
  const storeSetError = useConversationStore((s) => s.setError)
  const storeSetCompacting = useConversationStore((s) => s.setCompacting)
  const isOneBot = useConversationStore((s) => {
    const conv = s.conversations.find((c) => c.id === conversationId)
    const project = conv?.project_id ? s.projects.find((p) => p.id === conv.project_id) : undefined
    return project?.source_type.startsWith('onebot') ?? false
  })
  const isHostedAgent = useConversationStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.agent_kind === 'claude_code',
  )

  const messages = session?.messages ?? NO_MESSAGES
  const streaming = session?.streaming ?? false
  const compacting = session?.compacting ?? false
  const error = session?.error ?? null
  const activeTodos = session?.activeTodos ?? null

  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [pendingSticker, setPendingSticker] = useState<PendingSticker | null>(null)
  // What the *next* queued message will be, not a property of any row. Defaults
  // to the mode that waits: an interjection cuts into work that is already
  // going, which is not a thing to do by accident.
  const [queueDelivery, setQueueDelivery] = useState<QueueDelivery>('follow_up')
  const settings = useTurnSettings(conversationId)
  const emojiMap = useEmojiMap(settings.selectedAssistantId)
  // Only a OneBot conversation has more than one speaker; a desktop row has no
  // sender id to look up. Keyed on who is actually in the transcript so a
  // newcomer's first message fetches their nickname, and nothing else does.
  const speakerKey = useMemo(() => {
    if (!isOneBot) return null
    const ids = new Set<number>()
    for (const m of messages) {
      if (m.sender_id != null) ids.add(m.sender_id)
    }
    return [...ids].sort((a, b) => a - b).join(',')
  }, [isOneBot, messages])
  const senderNames = useSenderNames(speakerKey)
  const { t } = useTranslation()

  useEffect(() => {
    storeEnsureSession(conversationId)
    storeLoadMessages(conversationId)
    storeLoadActiveTodos(conversationId)
  }, [conversationId, storeEnsureSession, storeLoadMessages, storeLoadActiveTodos])

  const { sendMessage, steerMessage, handleRegenerate, handleEdit, handleVoiceSend } = useSendMessage(conversationId, {
    streaming,
    selectedAssistantId: settings.selectedAssistantId,
    selectedModelId: settings.selectedModelId,
    selectedProviderId: settings.selectedProviderId,
    thinkingLevel: settings.thinkingLevel,
    fastMode: settings.fastMode,
    mode: settings.mode,
  })

  // Read at click time rather than closed over, so the button always aims at
  // whatever is running now. Null falls back to "stop this conversation's
  // current turn", which is all a reloaded window knows.
  //
  // A hosted session stops through its own command, though **not because
  // `stop_chat` would miss it** — that used to be the reason given here and it
  // is not true. A hosted turn holds an ordinary lease, so `stop_chat` reaches
  // its cancellation token and `prompt_with` sends `session/cancel` off the
  // back of it. `acp_cancel` is the same act named for what it is, and it does
  // not need the turn id a reloaded window may not have.
  const handleStop = useCallback(() => {
    if (isHostedAgent) {
      api.acpCancel(conversationId)
      return
    }
    const turnId = useConversationStore.getState().sessions[conversationId]?.activeTurnId
    api.stopChat(conversationId, turnId)
  }, [conversationId, isHostedAgent])

  const handleDelete = useCallback(
    (id: string) => {
      api.deleteMessage(conversationId, id).then(() => {
        storeLoadMessages(conversationId)
      })
    },
    [conversationId, storeLoadMessages],
  )

  const handleRate = useCallback(
    (id: string, rating: number | null) => {
      api.rateMessage(id, rating).then(() => {
        storeLoadMessages(conversationId)
      })
    },
    [conversationId, storeLoadMessages],
  )

  const handleCompact = useCallback(
    async (instructions?: string) => {
      storeSetError(conversationId, null)
      try {
        await api.compact(conversationId, instructions)
      } catch (err) {
        storeSetError(conversationId, String(err))
        storeSetCompacting(conversationId, false)
      }
    },
    [conversationId, storeSetError, storeSetCompacting],
  )

  const initialMessageSent = useRef<string | null>(null)
  useEffect(() => {
    if (initialMessage && initialMessageSent.current !== conversationId) {
      initialMessageSent.current = conversationId
      onInitialMessageConsumed?.()
      sendMessage(initialMessage, true)
    }
  }, [conversationId, initialMessage, onInitialMessageConsumed, sendMessage])

  // Memoised because useTurns keys its work on this array's identity; a fresh
  // filter() on every render would rebuild every turn on every stream chunk.
  const visibleMessages = useMemo(
    () => messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.is_compact_summary !== 1),
    [messages],
  )
  const allTurns = useTurns(visibleMessages, streaming, session?.turns)
  const compactSummary = messages.find((m) => m.is_compact_summary === 1)
  // The boundary comes from the summary's anchor rather than a stored cursor:
  // once a conversation can branch, one sort_order threshold cannot describe
  // where the summary takes over on every path.
  const compactBoundary = useMemo(() => {
    const anchorId = compactSummary?.compact_anchor_id
    if (!anchorId) return null
    return messages.find((m) => m.id === anchorId)?.sort_order ?? null
  }, [compactSummary?.compact_anchor_id, messages])
  // Split by turn rather than by message: a boundary landing mid-turn used to
  // put the question in the compacted region and its answer in the active one.
  const compactedTurns = compactBoundary != null ? allTurns.filter((t) => t.firstSortOrder < compactBoundary) : []
  const activeTurns = compactBoundary != null ? allTurns.filter((t) => t.firstSortOrder >= compactBoundary) : allTurns
  const compactedCount =
    compactBoundary != null ? visibleMessages.filter((m) => m.sort_order < compactBoundary).length : 0

  const contextInfo = useContextInfo(conversationId, {
    assistant: settings.selectedAssistant,
    messageCount: messages.length,
    compactBoundary,
    compacting,
  })

  // Only a delegated run keeps an inbox open, and only while it is going. The
  // main conversation is unchanged: nothing can be submitted until the answer
  // is finished, because there is nowhere for it to go. Below `contextInfo`,
  // which is where the answer comes from.
  //
  // Named kinds rather than "has one at all". `steer_conversation` appends to
  // `sub_agent_inboxes`, which only a delegated run drains, while `agent_kind`
  // marks every conversation this app did not start on its own behalf — the
  // hook gates' reviews and now hosted Claude Code sessions. Read as a boolean
  // it lets the composer stay live during those and submit into an inbox that
  // does not exist, which comes back as "this run has already finished" on a
  // run that plainly has not.
  const steerable = contextInfo.agentKind === 'agent' || contextInfo.agentKind === 'explore'
  const steering = steerable && streaming

  // Everything with a runner behind it, which is a hosted session and an
  // ordinary conversation — but not a delegated run, which has `steerable` and
  // wants it: what is typed there goes straight into the run rather than being
  // stacked up for after it.
  const queueable = !steerable
  const queue = usePromptQueue(conversationId, queueable)
  const queueing = queueable && streaming

  const handleSubmit = useCallback(() => {
    const text = input.trim()
    if (!text && !pendingSticker) return

    // Ahead of everything else, including the slash commands: while the agent
    // is working there is no turn for any of them to reshape. The field is
    // cleared only once the row exists, so a refusal is not the user paying
    // for it by retyping.
    if (queueing) {
      if (!text) return
      void queue.enqueue(text, queueDelivery).then(() => setInput(''))
      return
    }

    // Before the slash commands, which all ask for a turn to be started or
    // reshaped and so have nowhere to land mid-run. The field is cleared only
    // once the run has taken the text: a refusal means it was written down
    // nowhere, and retyping it would be the user paying for that.
    if (steering) {
      if (!text) return
      void steerMessage(text).then((sent) => {
        if (sent) setInput('')
      })
      return
    }

    // `!isHostedAgent` for the same reason the gauge hides its manual compact
    // button: summarising a hosted transcript spends the user's own provider on
    // a history the agent never reads — it compacts its own context on its own
    // terms and a hosted prompt carries only the newest message — and then
    // folds their transcript away behind a summary nothing will use. On an
    // imported session, which is the longest kind there is, that is one of the
    // most expensive requests this app can make. Left through, it reaches
    // `commands::compact`, which has no `agent_kind` check and would price it
    // against the default assistant's model.
    if (!isHostedAgent && !pendingSticker && attachedFiles.length === 0 && text.startsWith('/compact')) {
      const instructions = text.slice('/compact'.length).trim() || undefined
      setInput('')
      handleCompact(instructions)
      return
    }

    const files = [...attachedFiles]
    setInput('')
    setAttachedFiles([])
    const sticker = pendingSticker
      ? { type: 'sticker' as const, sticker_id: pendingSticker.emoji.id, name: pendingSticker.emoji.name }
      : undefined
    setPendingSticker(null)
    sendMessage(text, true, files.length > 0 ? files : undefined, undefined, undefined, sticker)
  }, [
    input,
    sendMessage,
    attachedFiles,
    pendingSticker,
    handleCompact,
    isHostedAgent,
    steering,
    steerMessage,
    queueing,
    queue,
    queueDelivery,
  ])

  return (
    <div className="flex flex-col h-full">
      <ChatTranscript
        turns={activeTurns}
        conversationId={conversationId}
        streaming={streaming}
        onDelete={handleDelete}
        // Regenerate and edit are withheld on a hosted session. Both re-ask
        // from a point in the history, and a hosted session's history lives in
        // the adapter's process — `useSendMessage` refuses them for exactly
        // that reason, so leaving the buttons up offers an action whose only
        // outcome is an error message. The refusal stays as the backstop; this
        // is the affordance agreeing with it. Delete is still offered: it does
        // what it says, removing rows from *this* app's copy.
        onRegenerate={isHostedAgent ? undefined : handleRegenerate}
        onEdit={isHostedAgent ? undefined : handleEdit}
        onRate={handleRate}
        isOneBot={isOneBot}
        isHosted={isHostedAgent}
        emojiMap={emojiMap}
        senderNames={senderNames}
        assistantAvatar={settings.selectedAssistant?.avatar}
        leading={
          <CompactedRegion
            turns={compactedTurns}
            conversationId={conversationId}
            compactedCount={compactedCount}
            compactSummary={compactSummary}
            onDelete={handleDelete}
            isOneBot={isOneBot}
            emojiMap={emojiMap}
            senderNames={senderNames}
            assistantAvatar={settings.selectedAssistant?.avatar}
          />
        }
        trailing={<TranscriptStatus compacting={compacting} error={error} />}
        emptyState={
          messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-muted text-sm">{t('chat.startHint')}</div>
          ) : null
        }
        scrollToBottomLabel={t('chat.scrollToBottom')}
      />

      {/* Folded into the queue card when something is stacked: HeroUI's Queue
          is current-plus-rows, and a TodoBar sitting above it made every
          queued message look nested under the checklist — interject and
          follow-up alike. Alone, the bar keeps its own card. */}
      {queue.items.length === 0 && <TodoBar conversationId={conversationId} />}

      <InputBar
        conversationId={conversationId}
        isHosted={isHostedAgent}
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onVoiceSend={handleVoiceSend}
        onStop={handleStop}
        disabled={streaming}
        streaming={streaming}
        steerable={steerable}
        queueing={queueing}
        queueDelivery={queueDelivery}
        onSelectQueueDelivery={setQueueDelivery}
        queue={
          <PromptQueue
            items={queue.items}
            currentTodos={queue.items.length > 0 ? activeTodos : null}
            streaming={streaming}
            held={queue.held}
            onRemove={(id) => void queue.remove(id).catch((e) => storeSetError(conversationId, String(e)))}
            onReorder={(next) => void queue.reorder(next)}
            onSetDelivery={(id, delivery) => void queue.setDelivery(id, delivery)}
            onRelease={() => void queue.release()}
          />
        }
        assistants={settings.assistants}
        providers={settings.providers}
        currentAssistantId={settings.selectedAssistantId}
        currentModelId={settings.selectedModelId}
        currentProviderId={settings.selectedProviderId}
        onSelectAssistant={settings.onSelectAssistant}
        onSelectModel={settings.onSelectModel}
        thinkingLevel={settings.thinkingLevel}
        onSelectThinkingLevel={settings.onSelectThinkingLevel}
        fastMode={settings.fastMode}
        onToggleFast={settings.onToggleFast}
        mode={settings.mode}
        onSelectMode={settings.onSelectMode}
        acceptEdits={settings.acceptEdits}
        onToggleAcceptEdits={settings.onToggleAcceptEdits}
        capabilities={settings.capabilities}
        contextInfo={contextInfo}
        compacting={compacting}
        onCompact={() => handleCompact()}
        attachedFiles={attachedFiles}
        onAttachFiles={(files) => setAttachedFiles((prev) => [...prev, ...files])}
        onRemoveFile={(idx) => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
        pendingSticker={pendingSticker}
        onSelectSticker={setPendingSticker}
        onRemoveSticker={() => setPendingSticker(null)}
      />
    </div>
  )
}

interface ChatViewProps {
  conversationId: string
  initialMessage?: string | null
  onInitialMessageConsumed?: () => void
}

export function ChatView({ conversationId, initialMessage, onInitialMessageConsumed }: ChatViewProps) {
  return (
    <ChatViewInner
      conversationId={conversationId}
      initialMessage={initialMessage}
      onInitialMessageConsumed={onInitialMessageConsumed}
    />
  )
}
