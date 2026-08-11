import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Button, Spinner } from '@heroui/react'
import { ChatTranscript } from './chat-transcript'
import { TurnItem } from './turn-item'
import { useTurns } from '@/hooks/use-turns'
import { InputBar, type AttachedFile } from './input-bar'
import { TodoBar } from './todo-bar'
import { useEmojiMap } from './emoji-renderer'
import { useConversationStore } from '@/stores/conversation-store'
import { coerceThinkingLevel } from '@/lib/thinking'
import type { Assistant, ChatMode, Message, Provider, ProviderCapabilities, ThinkingLevel } from '@/types'

// Stable identity for the empty case: `?? []` would hand useTurns a new array on
// every render of a conversation whose session has not been created yet.
const NO_MESSAGES: Message[] = []

function ChatViewInner({ conversationId, initialMessage, onInitialMessageConsumed }: {
  conversationId: string
  initialMessage?: string | null
  onInitialMessageConsumed?: () => void
}) {
  const session = useConversationStore((s) => s.sessions[conversationId])
  const storeEnsureSession = useConversationStore((s) => s.ensureSession)
  const storeLoadMessages = useConversationStore((s) => s.loadMessages)
  const storeLoadActiveTodos = useConversationStore((s) => s.loadActiveTodos)
  const storeBeginTurn = useConversationStore((s) => s.beginTurn)
  const storeAbortTurn = useConversationStore((s) => s.abortTurn)
  const storeSetError = useConversationStore((s) => s.setError)
  const storeSetCompacting = useConversationStore((s) => s.setCompacting)
  const isOneBot = useConversationStore((s) => {
    const conv = s.conversations.find((c) => c.id === conversationId)
    const project = conv?.project_id ? s.projects.find((p) => p.id === conv.project_id) : undefined
    return project?.source_type.startsWith('onebot') ?? false
  })
  const conversationAssistantId = useConversationStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.assistant_id ?? null,
  )
  // Kept as two primitive selectors: returning an object here would allocate a
  // fresh reference on every store update and re-render on each one.
  const conversationThinkingLevel = useConversationStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.thinking_level ?? null,
  )
  const conversationFastMode = useConversationStore(
    (s) => (s.conversations.find((c) => c.id === conversationId)?.fast_mode ?? 0) !== 0,
  )
  const conversationMode = useConversationStore(
    (s) => (s.conversations.find((c) => c.id === conversationId)?.mode ?? 'work') as ChatMode,
  )
  const conversationAcceptEdits = useConversationStore(
    (s) => (s.conversations.find((c) => c.id === conversationId)?.accept_edits ?? 0) !== 0,
  )
  const refreshConversations = useConversationStore((s) => s.refreshConversations)

  const messages = session?.messages ?? NO_MESSAGES
  const streaming = session?.streaming ?? false
  const compacting = session?.compacting ?? false
  const error = session?.error ?? null

  const [input, setInput] = useState('')
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('default')
  const [fastMode, setFastMode] = useState(false)
  const [mode, setMode] = useState<ChatMode>('work')
  const [acceptEdits, setAcceptEdits] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [capabilities, setCapabilities] = useState<ProviderCapabilities | null>(null)
  const [showCompactedMessages, setShowCompactedMessages] = useState(false)
  const [showCompactSummary, setShowCompactSummary] = useState(false)
  const emojiMap = useEmojiMap(selectedAssistantId)
  const { t } = useTranslation()
  const submittingRef = useRef(false)

  useEffect(() => {
    storeEnsureSession(conversationId)
    storeLoadMessages(conversationId)
    storeLoadActiveTodos(conversationId)
  }, [conversationId])

  useEffect(() => {
    Promise.all([api.listAssistants(), api.listProviders()]).then(([a, p]) => {
      setAssistants(a)
      setProviders(p)
    })
  }, [])

  // Selection follows the conversation's bound assistant; falls back to the
  // global default only when the conversation has no (or a dangling) binding.
  useEffect(() => {
    if (assistants.length === 0) return
    const bound = conversationAssistantId
      ? assistants.find((x) => x.id === conversationAssistantId)
      : undefined
    const effective = bound ?? assistants.find((x) => x.is_default === 1) ?? assistants[0]
    if (effective) {
      setSelectedAssistantId(effective.id)
      setSelectedModelId(effective.model_id ?? null)
      setSelectedProviderId(effective.provider_id ?? null)
    }
  }, [conversationId, conversationAssistantId, assistants])

  const handleSelectAssistant = useCallback(
    (id: string) => {
      setSelectedAssistantId(id)
      const a = assistants.find((x) => x.id === id)
      if (a?.model_id) setSelectedModelId(a.model_id)
      if (a?.provider_id) setSelectedProviderId(a.provider_id)
      // Persist the explicit switch so the binding survives conversation changes
      api.setConversationAssistant(conversationId, id)
        .then(() => refreshConversations())
        .catch(() => { /* selection still applies locally for this session */ })
    },
    [assistants, conversationId, refreshConversations],
  )

  const handleSelectModel = useCallback((modelId: string, providerId: string) => {
    setSelectedModelId(modelId)
    setSelectedProviderId(providerId)
  }, [])

  useEffect(() => {
    if (!selectedProviderId || !selectedModelId) {
      // Clearing matters: keeping the previous model's capabilities would leave
      // the toolbar offering tiers the current selection may not support.
      setCapabilities(null)
      return
    }
    api.getProviderCapabilities(selectedProviderId, selectedModelId)
      .then(setCapabilities)
      .catch(() => setCapabilities(null))
  }, [selectedProviderId, selectedModelId])

  // Seed from the conversation's stored preferences on switch only. Keyed on
  // conversationId alone so a background refreshConversations() can't clobber
  // an edit the user just made.
  useEffect(() => {
    setThinkingLevel((conversationThinkingLevel as ThinkingLevel | null) ?? 'default')
    setFastMode(conversationFastMode)
    // `mode` is deliberately absent: unlike the two above it tracks the stored
    // value continuously (see below), because the backend changes it on its own
    // when a plan is approved.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed-on-switch; see comment
  }, [conversationId])

  // Model switch: drop to a tier the new model actually accepts. In-memory
  // only -- the stored preference keeps the user's original intent so switching
  // back to a more capable model restores it.
  useEffect(() => {
    if (!capabilities) return
    setThinkingLevel((cur) => coerceThinkingLevel(cur, capabilities))
    if (capabilities.supports_fast !== true) setFastMode(false)
  }, [capabilities])

  const handleSelectThinkingLevel = useCallback((level: ThinkingLevel) => {
    setThinkingLevel(level)
    api.setConversationReasoningPrefs(conversationId, level === 'default' ? null : level, fastMode)
      .then(() => refreshConversations())
      .catch(() => { /* selection still applies locally for this session */ })
  }, [conversationId, fastMode, refreshConversations])

  const handleToggleFast = useCallback((next: boolean) => {
    setFastMode(next)
    api.setConversationReasoningPrefs(
      conversationId,
      thinkingLevel === 'default' ? null : thinkingLevel,
      next,
    )
      .then(() => refreshConversations())
      .catch(() => { /* toggle still applies locally for this session */ })
  }, [conversationId, thinkingLevel, refreshConversations])

  const handleSelectMode = useCallback((next: ChatMode) => {
    const previous = mode
    setMode(next)
    api.setConversationMode(conversationId, next === 'work' ? null : next)
      .then(() => refreshConversations())
      .catch((err) => {
        // Rolled back rather than kept locally, unlike the other two toggles.
        // The mode decides whether the model can edit files at all, so a
        // toolbar showing a mode that did not take effect is worse than an
        // error: the user would think they were in a read-only conversation.
        setMode(previous)
        storeSetError(conversationId, String(err))
      })
  }, [conversationId, mode, refreshConversations, storeSetError])

  const handleToggleAcceptEdits = useCallback((next: boolean) => {
    const previous = acceptEdits
    setAcceptEdits(next)
    api.setConversationAcceptEdits(conversationId, next)
      .then(() => refreshConversations())
      .catch((err) => {
        // Rolled back rather than kept locally, for the same reason as the mode:
        // a toolbar claiming edits are pre-approved when the backend never
        // recorded it would have the user expecting silence and getting prompts
        // — or worse, the reverse.
        setAcceptEdits(previous)
        storeSetError(conversationId, String(err))
      })
  }, [conversationId, acceptEdits, refreshConversations, storeSetError])

  // Tracks the stored value continuously: approving a plan switches the mode on
  // the backend, which emits `conversation-updated`, and the toolbar has to
  // follow rather than keep claiming the conversation is still planning.
  useEffect(() => {
    setMode(conversationMode)
  }, [conversationMode])

  // Same reason, plus one of its own: switching conversations must not carry a
  // standing approval over from the one before it.
  useEffect(() => {
    setAcceptEdits(conversationAcceptEdits)
  }, [conversationAcceptEdits])

  // Read at click time rather than closed over, so the button always aims at
  // whatever is running now. Null falls back to "stop this conversation's
  // current turn", which is all a reloaded window knows.
  const handleStop = useCallback(() => {
    const turnId = useConversationStore.getState().sessions[conversationId]?.activeTurnId
    api.stopChat(conversationId, turnId)
  }, [conversationId])

  const handleDelete = useCallback((id: string) => {
    api.deleteMessage(conversationId, id).then(() => {
      storeLoadMessages(conversationId)
    })
  }, [conversationId, storeLoadMessages])

  const handleRate = useCallback((id: string, rating: number | null) => {
    api.rateMessage(id, rating).then(() => {
      storeLoadMessages(conversationId)
    })
  }, [conversationId, storeLoadMessages])

  const handleCompact = useCallback(async (instructions?: string) => {
    storeSetError(conversationId, null)
    try {
      await api.compact(conversationId, instructions)
    } catch (err) {
      storeSetError(conversationId, String(err))
      storeSetCompacting(conversationId, false)
    }
  }, [conversationId, storeSetError, storeSetCompacting])

  const sendMessage = useCallback(async (
    text: string | null,
    addUserBubble: boolean,
    files?: AttachedFile[],
    replaces?: string,
    voice?: boolean,
  ) => {
    // A null message means "regenerate", which needs no text of its own.
    if ((text === null ? !replaces : !text) || streaming || submittingRef.current) return
    submittingRef.current = true
    // Minted here, not by the backend, and handed to it. The composer locks on
    // this line; the backend's first event is several awaits away. Anything
    // arriving in between — most of all the previous turn's stop, which can be
    // delivered after its rejection has already unlocked the composer — has to
    // be measurable against an id that already exists.
    const turnId = crypto.randomUUID()
    storeBeginTurn(conversationId, turnId)
    const now = Date.now()

    let messageContent = text
    if (text !== null && files && files.length > 0) {
      try {
        const parts: unknown[] = [{ type: 'text', text }]
        for (const f of files) {
          const part = await api.uploadFile(conversationId, f.path)
          parts.push(part)
        }
        messageContent = JSON.stringify(parts)
      } catch (err) {
        storeAbortTurn(conversationId, turnId, String(err))
        submittingRef.current = false
        return
      }
    }

    // Drop the version being replaced before the new one starts arriving. It is
    // still on screen at this point, and everything after it on the path is its
    // descendant, so without this the old answer sits above the new one as it
    // streams in. The rows survive in the database; the reload on stop brings
    // back whatever the active path turns out to be, and the catch below
    // restores them if the request never lands.
    if (replaces) {
      useConversationStore.setState((state) => {
        const session = state.sessions[conversationId]
        if (!session) return state
        const idx = session.messages.findIndex((m) => m.id === replaces)
        if (idx < 0) return state
        return {
          sessions: {
            ...state.sessions,
            [conversationId]: { ...session, messages: session.messages.slice(0, idx) },
          },
        }
      })
    }

    if (addUserBubble && messageContent !== null) {
      useConversationStore.setState((state) => {
        const session = state.sessions[conversationId]
        if (!session) return state
        return {
          sessions: {
            ...state.sessions,
            [conversationId]: {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: `temp-user-${now}`,
                  conversation_id: conversationId,
                  role: 'user' as const,
                  content: messageContent,
                  provider_id: null,
                  model_id: null,
                  input_tokens: null,
                  output_tokens: null,
                  tool_calls: null,
                  tool_call_id: null,
                  sort_order: session.messages.length,
                  created_at: now,
                  reasoning_content: null,
                  rating: null,
                  schema_version: 2,
                  is_compact_summary: 0,
                },
              ],
            },
          },
        }
      })
    }

    api
      .chat(conversationId, messageContent, {
        turnId,
        replaces,
        modelOverride: selectedModelId ?? undefined,
        providerOverride: selectedProviderId ?? undefined,
        thinkingLevel: thinkingLevel !== 'default' ? thinkingLevel : undefined,
        assistantId: selectedAssistantId ?? undefined,
        fast: fastMode || undefined,
        mode,
        voice: voice || undefined,
      })
      .catch((err) => {
        // Message and all, by id: a rejection can land after the user has given
        // up and resent, and it must neither unlock the composer on the turn
        // that replaced it nor report its failure against it.
        storeAbortTurn(conversationId, turnId, String(err))
        submittingRef.current = false
        storeLoadMessages(conversationId)
      })
  }, [conversationId, streaming, selectedModelId, selectedProviderId, thinkingLevel, fastMode, mode, selectedAssistantId, storeBeginTurn, storeAbortTurn, storeLoadMessages])

  // Reset submittingRef when streaming ends
  useEffect(() => {
    if (!streaming) {
      submittingRef.current = false
    }
  }, [streaming])

  const initialMessageSent = useRef(false)
  useEffect(() => {
    if (initialMessage && !initialMessageSent.current) {
      initialMessageSent.current = true
      onInitialMessageConsumed?.()
      sendMessage(initialMessage, true)
    }
  }, [initialMessage])

  // Voice input sends directly, bypassing the textarea and any attachments.
  const handleVoiceSend = useCallback((text: string) => {
    if (text.trim()) sendMessage(text, true, undefined, undefined, true)
  }, [sendMessage])

  const handleSubmit = useCallback(() => {
    const text = input.trim()
    if (!text) return

    if (text.startsWith('/compact')) {
      const instructions = text.slice('/compact'.length).trim() || undefined
      setInput('')
      handleCompact(instructions)
      return
    }

    const files = [...attachedFiles]
    setInput('')
    setAttachedFiles([])
    sendMessage(text, true, files.length > 0 ? files : undefined)
  }, [input, sendMessage, attachedFiles, handleCompact])

  // Adds an answer beside the existing one instead of destroying it. This used
  // to delete the question and everything after it, then re-send — the old
  // answer was simply gone.
  const handleRegenerate = useCallback((messageId: string) => {
    sendMessage(null, false, undefined, messageId)
  }, [sendMessage])

  // Editing forks rather than overwrites: the question is re-asked as a sibling
  // of the original and answered fresh, leaving the old wording and its answer
  // reachable through the pager.
  const handleEdit = useCallback((id: string, content: string) => {
    sendMessage(content, true, undefined, id)
  }, [sendMessage])

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
  const compactedTurns = compactBoundary != null
    ? allTurns.filter((t) => t.firstSortOrder < compactBoundary)
    : []
  const activeTurns = compactBoundary != null
    ? allTurns.filter((t) => t.firstSortOrder >= compactBoundary)
    : allTurns
  const compactedCount = compactBoundary != null
    ? visibleMessages.filter((m) => m.sort_order < compactBoundary).length
    : 0

  const selectedAssistant = assistants.find((a) => a.id === selectedAssistantId)
  const [contextInfo, setContextInfo] = useState<{
    messageCount: number
    estimatedTokens: number
    contextLimit: number
    autoCompactEnabled: boolean
    autoCompactThreshold: number
    compactBreaker: string
  }>({
    messageCount: 0,
    estimatedTokens: 0,
    contextLimit: selectedAssistant?.context_limit ?? 128000,
    autoCompactEnabled: selectedAssistant?.auto_compact_enabled === 1,
    autoCompactThreshold: 0,
    compactBreaker: 'closed',
  })

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api.getContextInfo(conversationId).then((info) => {
        if (cancelled) return
        setContextInfo({
          messageCount: info.message_count,
          estimatedTokens: info.estimated_tokens,
          contextLimit: info.context_limit,
          autoCompactEnabled: info.auto_compact_enabled,
          autoCompactThreshold: info.compact_threshold,
          compactBreaker: info.circuit_breaker_state,
        })
      }).catch(() => {})
    }, 100)
    return () => { cancelled = true; clearTimeout(timer) }
    // `compacting` is in here for its falling edge. A pass that ran mid-turn
    // changes nothing on disk, so nothing else in this list moves — but it is
    // also where the circuit breaker opens, and a breaker that opened without
    // the indicator noticing leaves "0% until auto-compact" next to a number
    // that will now never come down.
  }, [conversationId, messages.length, compactBoundary, compacting])

  const leading = (
    <>
      {compactedTurns.length > 0 && (
        <MessageScrollerItem messageId="__compact-region" className="space-y-6">
          {showCompactedMessages ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setShowCompactedMessages(false)}
                className="w-full h-auto rounded-lg text-center text-xs text-muted hover:text-muted py-2"
              >
                {t('chat.compact.hideCompacted', { count: compactedCount })}
              </Button>
              {compactedTurns.map((turn) => (
                <div key={turn.id} className="opacity-40">
                  <TurnItem
                    turn={turn}
                    conversationId={conversationId}
                    onDelete={handleDelete}
                    isOneBot={isOneBot}
                    emojiMap={emojiMap}
                    assistantAvatar={selectedAssistant?.avatar}
                  />
                </div>
              ))}
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setShowCompactedMessages(true)}
              className="w-full h-auto rounded-lg text-center text-xs text-muted hover:text-muted py-2"
            >
              {t('chat.compact.showCompacted', { count: compactedCount })}
            </Button>
          )}
          <Marker variant="separator" className="py-3 px-2">
            <MarkerContent>
              <Button
                variant="ghost"
                onClick={() => setShowCompactSummary((v) => !v)}
                className="text-xs text-muted hover:text-muted whitespace-nowrap h-auto px-2 py-0"
              >
                {t('chat.compact.boundary', { count: compactedCount })}
              </Button>
            </MarkerContent>
          </Marker>
          {compactSummary && showCompactSummary && (
            <div className="px-4 py-2 mb-2 text-xs text-muted bg-default/30 rounded-lg border border-border whitespace-pre-wrap">
              {compactSummary.content}
            </div>
          )}
        </MessageScrollerItem>
      )}
    </>
  )

  const trailing = (
    <>
      {compacting && (
        <MessageScrollerItem messageId="__compacting">
          <Marker role="status" className="justify-center py-3">
            <MarkerIcon>
              {/* `sm` is 16px, the size of the icon slot. Left at its default
                  the spinner is 24px and overflows the row. */}
              <Spinner size="sm" />
            </MarkerIcon>
            <MarkerContent className="shimmer text-xs">{t('chat.compact.inProgress')}</MarkerContent>
          </Marker>
        </MessageScrollerItem>
      )}
      {/* After the turns, not before them: the error belongs to the turn that
          just failed, and the user is already at the bottom when it arrives.
          Deliberately not a scrollAnchor — an anchor aligns its item to the
          top of the viewport, which is what put the error out of sight in the
          first place. */}
      {error && (
        <MessageScrollerItem messageId="__error">
          <Bubble variant="destructive">
            <BubbleContent className="break-all">{error}</BubbleContent>
          </Bubble>
        </MessageScrollerItem>
      )}
    </>
  )

  return (
    <div className="flex flex-col h-full">
      <ChatTranscript
        turns={activeTurns}
        conversationId={conversationId}
        streaming={streaming}
        onDelete={handleDelete}
        onRegenerate={handleRegenerate}
        onEdit={handleEdit}
        onRate={handleRate}
        isOneBot={isOneBot}
        emojiMap={emojiMap}
        assistantAvatar={selectedAssistant?.avatar}
        leading={leading}
        trailing={trailing}
        emptyState={messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-muted text-sm">
            {t('chat.startHint')}
          </div>
        ) : null}
        scrollToBottomLabel={t('chat.scrollToBottom')}
      />

      <TodoBar conversationId={conversationId} />

      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onVoiceSend={handleVoiceSend}
        onStop={handleStop}
        disabled={streaming}
        streaming={streaming}
        assistants={assistants}
        providers={providers}
        currentAssistantId={selectedAssistantId}
        currentModelId={selectedModelId}
        currentProviderId={selectedProviderId}
        onSelectAssistant={handleSelectAssistant}
        onSelectModel={handleSelectModel}
        thinkingLevel={thinkingLevel}
        onSelectThinkingLevel={handleSelectThinkingLevel}
        fastMode={fastMode}
        onToggleFast={handleToggleFast}
        mode={mode}
        onSelectMode={handleSelectMode}
        acceptEdits={acceptEdits}
        onToggleAcceptEdits={handleToggleAcceptEdits}
        capabilities={capabilities}
        contextInfo={contextInfo}
        compacting={compacting}
        onCompact={() => handleCompact()}
        attachedFiles={attachedFiles}
        onAttachFiles={(files) => setAttachedFiles((prev) => [...prev, ...files])}
        onRemoveFile={(idx) => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
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
