import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import AnimatedContent from '@/components/AnimatedContent'
import { MessageItem } from './message-item'
import { InputBar, type AttachedFile } from './input-bar'
import { useEmojiMap } from './emoji-renderer'
import { useConversationStore } from '@/stores/conversation-store'
import type { Assistant, Provider, ProviderCapabilities, ThinkingLevel } from '@/types'

function AutoScrollArea({ children, dep }: { children: React.ReactNode; dep: unknown }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  function getViewport() {
    return rootRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null
  }

  useEffect(() => {
    if (stickRef.current) {
      requestAnimationFrame(() => {
        const el = getViewport()
        if (el) el.scrollTop = el.scrollHeight
      })
    }
  }, [dep])

  useEffect(() => {
    const el = getViewport()
    if (!el) return
    function handleScroll() {
      if (!el) return
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div ref={rootRef} className="flex-1 min-h-0">
      <ScrollArea className="h-full">
        <div className="px-4 py-6 space-y-6">
          {children}
        </div>
      </ScrollArea>
    </div>
  )
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
  const emojiMap = useEmojiMap(selectedAssistantId)
  const { t } = useTranslation()
  const submittingRef = useRef(false)

  useEffect(() => {
    storeEnsureSession(conversationId)
    if (!session || session.messages.length === 0) {
      storeLoadMessages(conversationId)
    }
  }, [conversationId])

  useEffect(() => {
    Promise.all([api.listAssistants(), api.listProviders()]).then(([a, p]) => {
      setAssistants(a)
      setProviders(p)
      const defaultAssistant = a.find((x) => x.is_default === 1) ?? a[0]
      if (defaultAssistant && !selectedAssistantId) {
        setSelectedAssistantId(defaultAssistant.id)
        if (defaultAssistant.model_id) setSelectedModelId(defaultAssistant.model_id)
        if (defaultAssistant.provider_id) setSelectedProviderId(defaultAssistant.provider_id)
      }
    })
  }, [])

  const handleSelectAssistant = useCallback(
    (id: string) => {
      setSelectedAssistantId(id)
      const a = assistants.find((x) => x.id === id)
      if (a?.model_id) setSelectedModelId(a.model_id)
      if (a?.provider_id) setSelectedProviderId(a.provider_id)
    },
    [assistants],
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
    }
  }, [conversationId, storeSetError])

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
    const msgIndex = messages.findIndex((m) => m.id === messageId)
    if (msgIndex < 0) return
    const userMsg = messages.slice(0, msgIndex).reverse().find((m) => m.role === 'user')
    if (!userMsg) return
    const targetMsg = messages[msgIndex]
    api.deleteMessagesFrom(conversationId, targetMsg.sort_order).then(() => {
      storeLoadMessages(conversationId).then(() => {
        sendMessage(userMsg.content, false)
      })
    })
  }, [messages, conversationId, sendMessage, storeLoadMessages])

  const visibleMessages = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.is_compact_summary !== 1)
  const compactedMessages = compactCursor != null
    ? visibleMessages.filter((m) => m.sort_order < compactCursor)
    : []
  const activeMessages = compactCursor != null
    ? visibleMessages.filter((m) => m.sort_order >= compactCursor)
    : visibleMessages
  const compactSummary = messages.find((m) => m.is_compact_summary === 1)
  const lastMsg = activeMessages[activeMessages.length - 1]

  const selectedAssistant = assistants.find((a) => a.id === selectedAssistantId)
  const contextInfo = useMemo(() => {
    const contextLimit = selectedAssistant?.context_limit ?? 128000
    const activeOnly = compactCursor != null
      ? messages.filter((m) => m.sort_order >= compactCursor || m.is_compact_summary === 1)
      : messages
    const estimatedTokens = activeOnly.reduce((sum, m) => sum + [...m.content].length + 4, 0)
    const autoCompactEnabled = selectedAssistant?.auto_compact_enabled === 1
    const autoCompactThreshold = Math.max(0, contextLimit - 33000)
    return { messageCount: activeMessages.length, estimatedTokens, contextLimit, autoCompactEnabled, autoCompactThreshold }
  }, [messages, activeMessages.length, selectedAssistant?.context_limit, selectedAssistant?.auto_compact_enabled, compactCursor])

  return (
    <div className="flex flex-col h-full">
      <AutoScrollArea dep={lastMsg ? `${lastMsg.id}:${lastMsg.content.length}:${lastMsg._blocks?.length ?? 0}` : null}>
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive break-all">
            {error}
          </div>
        )}

        {compactedMessages.length > 0 && (
          <>
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
                    <MessageItem
                      message={m}
                      isStreaming={false}
                      isLastMessage={false}
                      onDelete={handleDelete}
                      emojiMap={emojiMap}
                    />
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
            <div className="flex items-center gap-2 py-3 px-2">
              <div className="flex-1 border-t border-muted-foreground/20" />
              <Button
                variant="ghost"
                onClick={() => {
                  if (compactSummary) {
                    const el = document.getElementById('compact-summary')
                    if (el) el.classList.toggle('hidden')
                  }
                }}
                className="text-xs text-muted-foreground/60 hover:text-muted-foreground whitespace-nowrap h-auto px-2 py-0"
              >
                {t('chat.compact.boundary', { count: compactedMessages.length })}
              </Button>
              <div className="flex-1 border-t border-muted-foreground/20" />
            </div>
            {compactSummary && (
              <div id="compact-summary" className="hidden px-4 py-2 mb-2 text-xs text-muted-foreground bg-muted/30 rounded-lg border border-muted-foreground/10 whitespace-pre-wrap">
                {compactSummary.content}
              </div>
            )}
          </>
        )}

        {compacting && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground animate-pulse">
            {t('chat.compact.inProgress')}
          </div>
        )}

        {activeMessages.map((m, i) => {
          const messageEl = (
            <MessageItem
              key={m.id}
              message={m}
              isStreaming={streaming && i === activeMessages.length - 1 && m.role === 'assistant'}
              isLastMessage={i === activeMessages.length - 1}
              onDelete={handleDelete}
              onRegenerate={m.role === 'assistant' ? handleRegenerate : undefined}
              onEdit={m.role === 'user' && !streaming ? handleEdit : undefined}
              onRate={m.role === 'assistant' ? handleRate : undefined}
              emojiMap={emojiMap}
            />
          )
          if (i >= activeMessages.length - 6) {
            return (
              <AnimatedContent
                key={m.id}
                distance={20}
                duration={0.4}
                threshold={0.05}
                container="[data-slot='scroll-area-viewport']"
              >
                {messageEl}
              </AnimatedContent>
            )
          }
          return <div key={m.id}>{messageEl}</div>
        })}
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {t('chat.startHint')}
          </div>
        )}
      </AutoScrollArea>

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
