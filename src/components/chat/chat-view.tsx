import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { api } from '@/api'
import { MessageItem } from './message-item'
import { InputBar } from './input-bar'
import type { Message as DbMessage, StreamChunk, Assistant, Provider } from '@/types'

function AutoScrollDiv({ children, dep }: { children: React.ReactNode; dep: unknown }) {
  const ref = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  function handleScroll() {
    const el = ref.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useLayoutEffect(() => {
    if (stickRef.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [dep])

  return (
    <div ref={ref} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
      {children}
    </div>
  )
}

function ChatViewInner({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<DbMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const { t } = useTranslation()
  const conversationIdRef = useRef(conversationId)
  const submittingRef = useRef(false)
  conversationIdRef.current = conversationId

  useEffect(() => {
    api.loadMessages(conversationId).then(setMessages)
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
    const promise = listen<StreamChunk>('chat-stream', (event) => {
      if (event.payload.done) {
        setStreaming(false)
        submittingRef.current = false
        api.loadMessages(conversationIdRef.current).then(setMessages)
      } else {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + event.payload.content },
            ]
          }
          return prev
        })
      }
    })
    return () => {
      promise.then((fn) => fn())
    }
  }, [])

  const handleSubmit = useCallback(() => {
    const text = input.trim()
    if (!text || streaming || submittingRef.current) return
    submittingRef.current = true

    setInput('')
    setStreaming(true)
    setError(null)
    const now = Date.now()

    setMessages((prev) => [
      ...prev,
      {
        id: `temp-user-${now}`,
        conversation_id: conversationId,
        role: 'user',
        content: text,
        provider_id: null,
        model_id: null,
        input_tokens: null,
        output_tokens: null,
        tool_calls: null,
        tool_call_id: null,
        sort_order: prev.length,
        created_at: now,
      },
      {
        id: `temp-assistant-${now}`,
        conversation_id: conversationId,
        role: 'assistant',
        content: '',
        provider_id: selectedProviderId,
        model_id: selectedModelId,
        input_tokens: null,
        output_tokens: null,
        tool_calls: null,
        tool_call_id: null,
        sort_order: prev.length + 1,
        created_at: now,
      },
    ])

    api
      .chat(conversationId, text, selectedModelId ?? undefined, selectedProviderId ?? undefined)
      .catch((err) => {
        setError(String(err))
        setStreaming(false)
        submittingRef.current = false
        api.loadMessages(conversationId).then(setMessages)
      })
  }, [conversationId, input, streaming, selectedModelId, selectedProviderId])

  const visibleMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  const lastMsg = visibleMessages[visibleMessages.length - 1]

  return (
    <div className="flex flex-col h-full">
      <AutoScrollDiv dep={lastMsg?.content ?? null}>
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive break-all">
            {error}
          </div>
        )}
        {visibleMessages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            isStreaming={streaming && m.id.startsWith('temp-assistant-')}
          />
        ))}
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {t('chat.startHint')}
          </div>
        )}
      </AutoScrollDiv>

      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={streaming}
        streaming={streaming}
        assistants={assistants}
        providers={providers}
        currentAssistantId={selectedAssistantId}
        currentModelId={selectedModelId}
        currentProviderId={selectedProviderId}
        onSelectAssistant={handleSelectAssistant}
        onSelectModel={handleSelectModel}
      />
    </div>
  )
}

export function ChatView({ conversationId }: { conversationId: string }) {
  return <ChatViewInner key={conversationId} conversationId={conversationId} />
}
