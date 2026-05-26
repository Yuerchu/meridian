import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { listen } from '@tauri-apps/api/event'
import { api } from '@/api'
import type { Message as DbMessage, StreamChunk } from '@/types'

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
    <div ref={ref} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
      {children}
    </div>
  )
}

function ChatViewInner({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<DbMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const conversationIdRef = useRef(conversationId)
  const submittingRef = useRef(false)
  conversationIdRef.current = conversationId

  useEffect(() => {
    api.loadMessages(conversationId).then(setMessages)
  }, [conversationId])

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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
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
          provider_id: null,
          model_id: null,
          input_tokens: null,
          output_tokens: null,
          tool_calls: null,
          tool_call_id: null,
          sort_order: prev.length + 1,
          created_at: now,
        },
      ])

      try {
        await api.chat(conversationId, text)
      } catch (err) {
        setError(String(err))
        setStreaming(false)
        submittingRef.current = false
        api.loadMessages(conversationId).then(setMessages)
      }
    },
    [conversationId, input, streaming],
  )

  const visibleMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant')

  return (
    <div className="flex flex-col h-full">
      <AutoScrollDiv dep={visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1]?.content : null}>
        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800/50 rounded-lg text-sm text-red-300 break-all">
            {error}
          </div>
        )}
        {visibleMessages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {m.role === 'user' ? (
              <div className="max-w-[80%] rounded-2xl bg-neutral-800 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                {m.content}
              </div>
            ) : (
              <div className="max-w-[80%] text-sm leading-relaxed prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {m.content}
                </ReactMarkdown>
                {streaming && m.id.startsWith('temp-') && (
                  <span className="animate-pulse">|</span>
                )}
              </div>
            )}
          </div>
        ))}
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
            Send a message to start
          </div>
        )}
      </AutoScrollDiv>

      <form onSubmit={handleSubmit} className="p-4 border-t border-neutral-800">
        <div className="flex gap-2 max-w-2xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={streaming}
            className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm outline-none focus:border-neutral-500 disabled:opacity-50 placeholder:text-neutral-600"
            autoFocus
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="px-4 py-2 bg-neutral-100 text-neutral-900 text-sm font-medium rounded-lg hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {streaming ? '...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function ChatView({ conversationId }: { conversationId: string }) {
  return <ChatViewInner key={conversationId} conversationId={conversationId} />
}
