import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

interface StreamChunk {
  content: string
  done: boolean
}

export default function Chat() {
  const [input, setInput] = useState('')
  const [response, setResponse] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || streaming) return

    setStreaming(true)
    setResponse('')
    setError(null)

    const unlisten = await listen<StreamChunk>('chat-stream', (event) => {
      if (event.payload.done) {
        setStreaming(false)
      } else {
        setResponse((prev) => prev + event.payload.content)
      }
    })

    try {
      await invoke('chat', { message: input })
    } catch (err) {
      setError(String(err))
      setStreaming(false)
    }

    unlisten()
  }

  return (
    <>
      <main className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="max-w-2xl mx-auto mb-4 p-3 bg-red-950/50 border border-red-800/50 rounded-lg text-sm text-red-300">
            {error}
          </div>
        )}
        {response ? (
          <div className="max-w-2xl mx-auto whitespace-pre-wrap font-mono text-sm leading-relaxed">
            {response}
            {streaming && <span className="animate-pulse">|</span>}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
            Send a message to start
          </div>
        )}
      </main>

      <form onSubmit={handleSubmit} className="p-4 border-t border-neutral-800">
        <div className="flex gap-2 max-w-2xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={streaming}
            className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm outline-none focus:border-neutral-500 disabled:opacity-50 placeholder:text-neutral-600"
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
    </>
  )
}
