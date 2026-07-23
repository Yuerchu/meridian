import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { useImeBottom } from '@/hooks/use-android-insets'
import { Button } from '@/components/ui/button'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Spinner } from '@/components/ui/spinner'
import { motion } from 'motion/react'
import { ErrorBoundary } from '@/components/error-boundary'
import { MessageItem } from './message-item'
import { useMessageScroller } from '@/components/ui/message-scroller'
import { InputBar, type AttachedFile } from './input-bar'
import { useEmojiMap } from './emoji-renderer'
import { useConversationStore } from '@/stores/conversation-store'
import type { Assistant, Provider, ProviderCapabilities, ThinkingLevel } from '@/types'

const MotionMessageScrollerItem = motion.create(MessageScrollerItem)

function ImeScrollSync() {
  const ime = useImeBottom()
  const { scrollToEnd } = useMessageScroller()
  useEffect(() => { if (ime > 0) scrollToEnd() }, [ime, scrollToEnd])
  return null
}

function ChatViewInner({ conversationId, initialMessage, onInitialMessageConsumed }: {
  conversationId: string
  initialMessage?: string | null
  onInitialMessageConsumed?: () => void
}) {
  const session = useConversationStore((s) => s.sessions[conversationId])
  const storeEnsureSession = useConversationStore((s) => s.ensureSession)
  const storeLoadMessages = useConversationStore((s) => s.loadMessages)
  const storeSetStreaming = useConversationStore((s) => s.setStreaming)
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
  const refreshConversations = useConversationStore((s) => s.refreshConversations)

  const messages = session?.messages ?? []
  const streaming = session?.streaming ?? false
  const compacting = session?.compacting ?? false
  const error = session?.error ?? null
  const compactCursor = session?.compactCursor ?? null

  const [input, setInput] = useState('')
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('default')
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
    if (selectedProviderId && selectedModelId) {
      api.getProviderCapabilities(selectedProviderId, selectedModelId)
        .then(setCapabilities)
        .catch(() => setCapabilities(null))
    }
  }, [selectedProviderId, selectedModelId])

  const handleStop = useCallback(() => {
    api.stopChat(conversationId)
  }, [conversationId])

  const handleDelete = useCallback((id: string) => {
    api.deleteMessage(id).then(() => {
      storeLoadMessages(conversationId)
    })
  }, [conversationId, storeLoadMessages])

  const handleEdit = useCallback((id: string, content: string) => {
    api.updateMessageContent(id, content).then(() => {
      storeLoadMessages(conversationId)
    }).catch((err) => {
      storeSetError(conversationId, String(err))
    })
  }, [conversationId, storeLoadMessages, storeSetError])

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

  const sendMessage = useCallback(async (text: string, addUserBubble: boolean, files?: AttachedFile[]) => {
    if (!text || streaming || submittingRef.current) return
    submittingRef.current = true
    storeSetStreaming(conversationId, true)
    storeSetError(conversationId, null)
    const now = Date.now()

    let messageContent = text
    if (files && files.length > 0) {
      try {
        const parts: unknown[] = [{ type: 'text', text }]
        for (const f of files) {
          const part = await api.uploadFile(conversationId, f.path)
          parts.push(part)
        }
        messageContent = JSON.stringify(parts)
      } catch (err) {
        storeSetError(conversationId, String(err))
        storeSetStreaming(conversationId, false)
        submittingRef.current = false
        return
      }
    }

    if (addUserBubble) {
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
      .chat(conversationId, messageContent, selectedModelId ?? undefined, selectedProviderId ?? undefined, thinkingLevel !== 'default' ? thinkingLevel : undefined, selectedAssistantId ?? undefined)
      .catch((err) => {
        storeSetError(conversationId, String(err))
        storeSetStreaming(conversationId, false)
        submittingRef.current = false
        storeLoadMessages(conversationId)
      })
  }, [conversationId, streaming, selectedModelId, selectedProviderId, thinkingLevel, selectedAssistantId, storeSetStreaming, storeSetError, storeLoadMessages])

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

  const handleRegenerate = useCallback((messageId: string) => {
    const msgs = useConversationStore.getState().sessions[conversationId]?.messages ?? []
    const msgIndex = msgs.findIndex((m) => m.id === messageId)
    if (msgIndex < 0) return
    const userMsg = msgs.slice(0, msgIndex).reverse().find((m) => m.role === 'user')
    if (!userMsg) return
    // The chat command always persists the incoming user message, so delete the
    // original user message too and let sendMessage re-create it.
    api.deleteMessagesFrom(conversationId, userMsg.sort_order).then(() => {
      storeLoadMessages(conversationId).then(() => {
        sendMessage(userMsg.content, true)
      })
    })
  }, [conversationId, sendMessage, storeLoadMessages])

  const visibleMessages = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.is_compact_summary !== 1)
  const compactedMessages = compactCursor != null
    ? visibleMessages.filter((m) => m.sort_order < compactCursor)
    : []
  const activeMessages = compactCursor != null
    ? visibleMessages.filter((m) => m.sort_order >= compactCursor)
    : visibleMessages
  const compactSummary = messages.find((m) => m.is_compact_summary === 1)

  const selectedAssistant = assistants.find((a) => a.id === selectedAssistantId)
  const [contextInfo, setContextInfo] = useState<{
    messageCount: number
    estimatedTokens: number
    contextLimit: number
    autoCompactEnabled: boolean
    autoCompactThreshold: number
  }>({
    messageCount: 0,
    estimatedTokens: 0,
    contextLimit: selectedAssistant?.context_limit ?? 128000,
    autoCompactEnabled: selectedAssistant?.auto_compact_enabled === 1,
    autoCompactThreshold: 0,
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
        })
      }).catch(() => {})
    }, 100)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [conversationId, messages.length, compactCursor])

  return (
    <div className="flex flex-col h-full">
      <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={48}>
        <ImeScrollSync />
        <MessageScroller className="flex-1 min-h-0">
          <MessageScrollerViewport>
            <MessageScrollerContent className="max-w-4xl mx-auto px-4 py-6">
        {error && (
          <MessageScrollerItem messageId="__error">
            <Bubble variant="destructive">
              <BubbleContent className="break-all">{error}</BubbleContent>
            </Bubble>
          </MessageScrollerItem>
        )}

        {compactedMessages.length > 0 && (
          <MessageScrollerItem messageId="__compact-region" className="space-y-6">
            {showCompactedMessages ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setShowCompactedMessages(false)}
                  className="w-full text-center text-xs text-muted-foreground/60 hover:text-muted-foreground py-2"
                >
                  {t('chat.compact.hideCompacted', { count: compactedMessages.length })}
                </Button>
                {compactedMessages.map((m) => (
                  <div key={m.id} className="opacity-40">
                    <ErrorBoundary fallback={<div className="text-xs text-destructive">{t('chat.renderError')}</div>}>
                      <MessageItem
                        message={m}
                        isStreaming={false}
                        isLastMessage={false}
                        onDelete={handleDelete}
                        isOneBot={isOneBot}
                        emojiMap={emojiMap}
                        assistantAvatar={selectedAssistant?.avatar}
                      />
                    </ErrorBoundary>
                  </div>
                ))}
              </>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setShowCompactedMessages(true)}
                className="w-full text-center text-xs text-muted-foreground/60 hover:text-muted-foreground py-2"
              >
                {t('chat.compact.showCompacted', { count: compactedMessages.length })}
              </Button>
            )}
            <Marker variant="separator" className="py-3 px-2">
              <MarkerContent>
                <Button
                  variant="ghost"
                  onClick={() => setShowCompactSummary((v) => !v)}
                  className="text-xs text-muted-foreground/60 hover:text-muted-foreground whitespace-nowrap h-auto px-2 py-0"
                >
                  {t('chat.compact.boundary', { count: compactedMessages.length })}
                </Button>
              </MarkerContent>
            </Marker>
            {compactSummary && showCompactSummary && (
              <div className="px-4 py-2 mb-2 text-xs text-muted-foreground bg-muted/30 rounded-lg border border-muted-foreground/10 whitespace-pre-wrap">
                {compactSummary.content}
              </div>
            )}
          </MessageScrollerItem>
        )}

        {activeMessages.map((m, i) => {
          const prev = i > 0 ? activeMessages[i - 1] : null
          const next = i < activeMessages.length - 1 ? activeMessages[i + 1] : null
          const isSameGroup = (a: typeof m | null, b: typeof m | null) =>
            a != null && b != null && a.role === 'assistant' && b.role === 'assistant' && a.model_id === b.model_id
          const isFirstInGroup = !isSameGroup(prev, m)
          const isLastInGroup = !isSameGroup(m, next)
          const messageEl = (
            <ErrorBoundary fallback={<div className="text-xs text-destructive py-2">{t('chat.renderError')}</div>}>
              <MessageItem
                message={m}
                isStreaming={streaming && i === activeMessages.length - 1 && m.role === 'assistant'}
                isLastMessage={i === activeMessages.length - 1}
                onDelete={handleDelete}
                onRegenerate={m.role === 'assistant' ? handleRegenerate : undefined}
                onEdit={m.role === 'user' && !streaming ? handleEdit : undefined}
                onRate={m.role === 'assistant' ? handleRate : undefined}
                isOneBot={isOneBot}
                emojiMap={emojiMap}
                assistantAvatar={selectedAssistant?.avatar}
                isFirstInGroup={isFirstInGroup}
                isLastInGroup={isLastInGroup}
              />
            </ErrorBoundary>
          )
          if (i >= activeMessages.length - 6) {
            return (
              <MotionMessageScrollerItem
                key={m.id}
                messageId={m.id}
                scrollAnchor={m.role === 'user'}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
              >
                {messageEl}
              </MotionMessageScrollerItem>
            )
          }
          return (
            <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === 'user'}>
              {messageEl}
            </MessageScrollerItem>
          )
        })}
        {compacting && (
          <MessageScrollerItem messageId="__compacting">
            <Marker role="status" className="justify-center py-3">
              <MarkerIcon>
                <Spinner />
              </MarkerIcon>
              <MarkerContent className="shimmer text-xs">{t('chat.compact.inProgress')}</MarkerContent>
            </Marker>
          </MessageScrollerItem>
        )}
        {messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            {t('chat.startHint')}
          </div>
        )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton aria-label={t('chat.scrollToBottom')} />
        </MessageScroller>
      </MessageScrollerProvider>

      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
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
        onSelectThinkingLevel={setThinkingLevel}
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
