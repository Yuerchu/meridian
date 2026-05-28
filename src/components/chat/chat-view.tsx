import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { api } from '@/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageItem } from './message-item'
import { InputBar } from './input-bar'
import type { Message as DbMessage, StreamChunk, Assistant, Provider, ToolCallDisplay, ContentBlock, ThinkingLevel } from '@/types'

function hydrateBlocks(msgs: DbMessage[]): DbMessage[] {
  return msgs.map((m) => {
    if (m.role === 'assistant' && m.tool_calls) {
      try {
        const blocks = JSON.parse(m.tool_calls) as ContentBlock[]
        return { ...m, _blocks: blocks }
      } catch { /* ignore malformed JSON */ }
    }
    return m
  })
}

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
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('default')
  const { t } = useTranslation()
  const conversationIdRef = useRef(conversationId)
  const submittingRef = useRef(false)
  conversationIdRef.current = conversationId

  useEffect(() => {
    api.loadMessages(conversationId).then((msgs) => setMessages(hydrateBlocks(msgs)))
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

  const handleStop = useCallback(() => {
    api.stopChat(conversationId)
  }, [conversationId])

  const handleDelete = useCallback((id: string) => {
    api.deleteMessage(id).then(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id))
    })
  }, [])

  useEffect(() => {
    const promise = listen<StreamChunk>('chat-stream', (event) => {
      const p = event.payload

      if (p.done) {
        setStreaming(false)
        submittingRef.current = false
        api.loadMessages(conversationIdRef.current).then((msgs) => {
          setMessages(hydrateBlocks(msgs))
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

      if (p.type === 'reasoning' && p.content) {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            const blocks = [...(last._blocks ?? [])]
            const lastBlock = blocks[blocks.length - 1]
            if (lastBlock?.type === 'thinking') {
              blocks[blocks.length - 1] = { type: 'thinking', text: lastBlock.text + p.content }
            } else {
              blocks.push({ type: 'thinking', text: p.content! })
            }
            return [...prev.slice(0, -1), { ...last, _blocks: blocks }]
          }
          return prev
        })
        return
      }

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

  const sendMessage = useCallback((text: string, addUserBubble: boolean) => {
    if (!text || streaming || submittingRef.current) return
    submittingRef.current = true
    setStreaming(true)
    setError(null)
    const now = Date.now()

    if (addUserBubble) {
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
    } else {
      setMessages((prev) => [
        ...prev,
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
          sort_order: prev.length,
          created_at: now,
        },
      ])
    }

    api
      .chat(conversationId, text, selectedModelId ?? undefined, selectedProviderId ?? undefined, thinkingLevel !== 'default' ? thinkingLevel : undefined)
      .catch((err) => {
        setError(String(err))
        setStreaming(false)
        submittingRef.current = false
        api.loadMessages(conversationId).then((msgs) => setMessages(hydrateBlocks(msgs)))
      })
  }, [conversationId, streaming, selectedModelId, selectedProviderId, thinkingLevel])

  const handleSubmit = useCallback(() => {
    const text = input.trim()
    if (!text) return
    setInput('')
    sendMessage(text, true)
  }, [input, sendMessage])

  const handleRegenerate = useCallback((messageId: string) => {
    const msgIndex = messages.findIndex((m) => m.id === messageId)
    if (msgIndex < 0) return
    const userMsg = messages.slice(0, msgIndex).reverse().find((m) => m.role === 'user')
    if (!userMsg) return
    const targetMsg = messages[msgIndex]
    api.deleteMessagesFrom(conversationId, targetMsg.sort_order).then(() => {
      setMessages((prev) => prev.filter((m) => m.sort_order < targetMsg.sort_order))
      sendMessage(userMsg.content, false)
    })
  }, [messages, conversationId, sendMessage])

  const visibleMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  const lastMsg = visibleMessages[visibleMessages.length - 1]

  const selectedAssistant = assistants.find((a) => a.id === selectedAssistantId)
  const contextInfo = useMemo(() => {
    const contextLimit = selectedAssistant?.context_limit ?? 128000
    const estimatedTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4) + 4, 0)
    return { messageCount: visibleMessages.length, estimatedTokens, contextLimit }
  }, [messages, visibleMessages.length, selectedAssistant?.context_limit])

  return (
    <div className="flex flex-col h-full">
      <AutoScrollArea dep={lastMsg ? `${lastMsg.id}:${lastMsg.content.length}:${lastMsg._blocks?.length ?? 0}` : null}>
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
            onDelete={handleDelete}
            onRegenerate={m.role === 'assistant' ? handleRegenerate : undefined}
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
        contextInfo={contextInfo}
      />
    </div>
  )
}

export function ChatView({ conversationId }: { conversationId: string }) {
  return <ChatViewInner key={conversationId} conversationId={conversationId} />
}
