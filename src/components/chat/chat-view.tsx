import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { api } from '@/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageItem } from './message-item'
import { InputBar, type AttachedFile } from './input-bar'
import { useEmojiMap } from './emoji-renderer'
import type { Message as DbMessage, StreamChunk, Assistant, Provider, ProviderCapabilities, ToolCallDisplay, ContentBlock, OpenAIToolCall, ThinkingLevel } from '@/types'

function hydrateBlocks(msgs: DbMessage[]): DbMessage[] {
  return msgs.map((m) => {
    if (m.role !== 'assistant') return m

    if (m.schema_version >= 2) {
      const blocks: ContentBlock[] = []
      if (m.reasoning_content) {
        blocks.push({ type: 'thinking', text: m.reasoning_content })
      }
      if (m.content) {
        blocks.push({ type: 'text', text: m.content })
      }
      if (m.tool_calls) {
        try {
          const tcs = JSON.parse(m.tool_calls) as OpenAIToolCall[]
          for (const tc of tcs) {
            const toolMsg = msgs.find((tm) => tm.role === 'tool' && tm.tool_call_id === tc.id)
            blocks.push({
              type: 'tool_call',
              data: {
                call_id: tc.id,
                tool_name: tc.function.name,
                arguments: tc.function.arguments,
                status: 'completed',
                result: toolMsg?.content,
              },
            })
          }
        } catch { /* ignore */ }
      }
      return { ...m, _blocks: blocks.length > 0 ? blocks : undefined }
    }

    // Legacy v1 format
    if (m.tool_calls) {
      try {
        const blocks = JSON.parse(m.tool_calls) as ContentBlock[]
        return { ...m, _blocks: blocks }
      } catch { /* ignore */ }
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
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [capabilities, setCapabilities] = useState<ProviderCapabilities | null>(null)
  const emojiMap = useEmojiMap(selectedAssistantId)
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
      setMessages((prev) => prev.filter((m) => m.id !== id))
    })
  }, [])

  const handleEdit = useCallback((id: string, content: string) => {
    api.updateMessageContent(id, content).then(() => {
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, content } : m))
    }).catch((err) => {
      setError(String(err))
    })
  }, [])

  const handleRate = useCallback((id: string, rating: number | null) => {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, rating } : m))
    api.rateMessage(id, rating).catch(() => {
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, rating: null } : m))
    })
  }, [])

  useEffect(() => {
    const findAssistantMsg = (msgs: DbMessage[], messageId?: string): number => {
      if (messageId) {
        const idx = msgs.findIndex((m) => m.id === messageId)
        if (idx >= 0) return idx
      }
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') return i
      }
      return -1
    }

    const promise = listen<StreamChunk>('chat-stream', (event) => {
      const p = event.payload

      if (p.type === 'stop' || p.done) {
        setStreaming(false)
        submittingRef.current = false
        api.loadMessages(conversationIdRef.current).then((msgs) => {
          setMessages(hydrateBlocks(msgs))
        })
        return
      }

      if (p.type === 'message_start' && p.message_id) {
        setMessages((prev) => [
          ...prev,
          {
            id: p.message_id!,
            conversation_id: conversationIdRef.current,
            role: 'assistant' as const,
            content: '',
            provider_id: null,
            model_id: null,
            input_tokens: null,
            output_tokens: null,
            tool_calls: null,
            tool_call_id: null,
            sort_order: prev.length,
            created_at: Date.now(),
            reasoning_content: null,
            rating: null,
            schema_version: 2,
          },
        ])
        return
      }

      if ((p.type === 'tool_call' || p.type === 'tool_approval_req' || p.type === 'tool_result') && p.call_id) {
        setMessages((prev) => {
          const targetIdx = findAssistantMsg(prev, p.message_id)
          if (targetIdx < 0) return prev
          const target = prev[targetIdx]

          const blocks = [...(target._blocks ?? [])]

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
          updated[targetIdx] = { ...target, _blocks: blocks }
          return updated
        })
        return
      }

      if (p.type === 'reasoning' && p.content) {
        setMessages((prev) => {
          const targetIdx = findAssistantMsg(prev, p.message_id)
          if (targetIdx < 0) return prev
          const target = prev[targetIdx]

          const blocks = [...(target._blocks ?? [])]
          const lastBlock = blocks[blocks.length - 1]
          if (lastBlock?.type === 'thinking') {
            blocks[blocks.length - 1] = { type: 'thinking', text: lastBlock.text + p.content }
          } else {
            blocks.push({ type: 'thinking', text: p.content! })
          }
          const updated = [...prev]
          updated[targetIdx] = { ...target, _blocks: blocks }
          return updated
        })
        return
      }

      if (p.type === 'text' && p.content) {
        setMessages((prev) => {
          const targetIdx = findAssistantMsg(prev, p.message_id)
          if (targetIdx < 0) return prev
          const target = prev[targetIdx]

          const blocks = [...(target._blocks ?? [])]
          const lastBlock = blocks[blocks.length - 1]
          if (lastBlock?.type === 'text') {
            blocks[blocks.length - 1] = { type: 'text', text: lastBlock.text + p.content }
          } else {
            blocks.push({ type: 'text', text: p.content! })
          }
          const updated = [...prev]
          updated[targetIdx] = { ...target, content: target.content + p.content, _blocks: blocks }
          return updated
        })
      }
    })
    return () => {
      promise.then((fn) => fn())
    }
  }, [])

  const sendMessage = useCallback(async (text: string, addUserBubble: boolean, files?: AttachedFile[]) => {
    if (!text || streaming || submittingRef.current) return
    submittingRef.current = true
    setStreaming(true)
    setError(null)
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
        setError(String(err))
        setStreaming(false)
        submittingRef.current = false
        return
      }
    }

    if (addUserBubble) {
      setMessages((prev) => [
        ...prev,
        {
          id: `temp-user-${now}`,
          conversation_id: conversationId,
          role: 'user',
          content: messageContent,
          provider_id: null,
          model_id: null,
          input_tokens: null,
          output_tokens: null,
          tool_calls: null,
          tool_call_id: null,
          sort_order: prev.length,
          created_at: now,
          reasoning_content: null,
          rating: null,
          schema_version: 2,
        },
      ])
    }

    api
      .chat(conversationId, messageContent, selectedModelId ?? undefined, selectedProviderId ?? undefined, thinkingLevel !== 'default' ? thinkingLevel : undefined, selectedAssistantId ?? undefined)
      .catch((err) => {
        setError(String(err))
        setStreaming(false)
        submittingRef.current = false
        api.loadMessages(conversationId).then((msgs) => setMessages(hydrateBlocks(msgs)))
      })
  }, [conversationId, streaming, selectedModelId, selectedProviderId, thinkingLevel, selectedAssistantId])

  const handleSubmit = useCallback(() => {
    const text = input.trim()
    if (!text) return
    const files = [...attachedFiles]
    setInput('')
    setAttachedFiles([])
    sendMessage(text, true, files.length > 0 ? files : undefined)
  }, [input, sendMessage, attachedFiles])

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
    const estimatedTokens = messages.reduce((sum, m) => sum + [...m.content].length + 4, 0)
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
        {visibleMessages.map((m, i) => (
          <MessageItem
            key={m.id}
            message={m}
            isStreaming={streaming && i === visibleMessages.length - 1 && m.role === 'assistant'}
            isLastMessage={i === visibleMessages.length - 1}
            onDelete={handleDelete}
            onRegenerate={m.role === 'assistant' ? handleRegenerate : undefined}
            onEdit={m.role === 'user' && !streaming ? handleEdit : undefined}
            onRate={m.role === 'assistant' ? handleRate : undefined}
            emojiMap={emojiMap}
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
        capabilities={capabilities}
        contextInfo={contextInfo}
        attachedFiles={attachedFiles}
        onAttachFiles={(files) => setAttachedFiles((prev) => [...prev, ...files])}
        onRemoveFile={(idx) => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
      />
    </div>
  )
}

export function ChatView({ conversationId }: { conversationId: string }) {
  return <ChatViewInner key={conversationId} conversationId={conversationId} />
}
