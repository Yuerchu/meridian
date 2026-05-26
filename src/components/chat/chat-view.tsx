import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { api } from '@/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageItem } from './message-item'
import { InputBar } from './input-bar'
// ToolCallBlock is rendered inside MessageItem via _toolCallDisplays
import type { Message as DbMessage, StreamChunk, Assistant, Provider, ToolCallDisplay } from '@/types'

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
      const p = event.payload

      if (p.done) {
        setStreaming(false)
        submittingRef.current = false
        api.loadMessages(conversationIdRef.current).then((dbMessages) => {
          setMessages((prev) => {
            const blocksMap = new Map<string, typeof prev[0]['_blocks']>()
            for (const m of prev) {
              if (m._blocks?.length) {
                blocksMap.set(m.id, m._blocks)
              }
            }
            if (blocksMap.size === 0) return dbMessages
            return dbMessages.map((m) => {
              const tempKey = [...blocksMap.keys()].find((k) => k.startsWith('temp-'))
              if (m.role === 'assistant' && tempKey) {
                const blocks = blocksMap.get(tempKey)
                blocksMap.delete(tempKey)
                if (blocks?.length) {
                  return { ...m, _blocks: blocks }
                }
              }
              return m
            })
          })
        })
        return
      }

      if ((p.type === 'tool_call' || p.type === 'tool_approval_req' || p.type === 'tool_result') && p.call_id) {
        setMessages((prev) => {
          const lastIdx = prev.length - 1
          const last = prev[lastIdx]
          if (!last || last.role !== 'assistant') return prev

          const blocks = [...(last._blocks ?? [])]

          if (p.type === 'tool_call') {
            blocks.push({
              type: 'tool_call',
              data: {
                call_id: p.call_id!,
                tool_name: p.tool_name!,
                arguments: p.arguments ?? '{}',
                status: 'running',
              },
            })
          } else {
            const idx = blocks.findIndex(
              (b) => b.type === 'tool_call' && b.data.call_id === p.call_id,
            )
            if (idx >= 0 && blocks[idx].type === 'tool_call') {
              const tc = blocks[idx] as { type: 'tool_call'; data: ToolCallDisplay }
              if (p.type === 'tool_approval_req') {
                blocks[idx] = { type: 'tool_call', data: { ...tc.data, status: 'pending' } }
              } else if (p.type === 'tool_result') {
                blocks[idx] = { type: 'tool_call', data: { ...tc.data, status: 'completed', result: p.result } }
              }
            }
          }

          const updated = [...prev]
          updated[lastIdx] = { ...last, _blocks: blocks }
          return updated
        })
        return
      }

      // Regular text chunk — append to last text block or create new one
      if (p.content) {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            const blocks = [...(last._blocks ?? [])]
            const lastBlock = blocks[blocks.length - 1]
            if (lastBlock?.type === 'text') {
              blocks[blocks.length - 1] = { type: 'text', text: lastBlock.text + p.content }
            } else {
              blocks.push({ type: 'text', text: p.content! })
            }
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + p.content, _blocks: blocks },
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
      <AutoScrollArea dep={lastMsg ? `${lastMsg.id}:${lastMsg.content.length}` : null}>
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
      </AutoScrollArea>

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
