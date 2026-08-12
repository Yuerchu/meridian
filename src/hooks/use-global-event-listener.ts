import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { useConversationStore } from '@/stores/conversation-store'
import type { StreamChunk } from '@/types'

// Keyed by turn, not by conversation. Keyed by conversation, a second turn's
// stop deleted the first one's start time and the "this took a while" notice
// went to whichever turn happened to finish first.
const streamStartTimes = new Map<string, number>()
const LONG_STREAM_THRESHOLD_MS = 30_000

// Text/reasoning chunks arrive far faster than the screen refreshes; applying
// each one individually makes every token re-render the chat. Buffer them and
// flush at most once per frame, preserving arrival order across chunk types.
const CHUNK_FLUSH_MS = 24
const chunkQueue: Array<{ convId: string; messageId: string; type: 'text' | 'reasoning'; content: string }> = []
let chunkFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushChunks() {
  if (chunkFlushTimer !== null) {
    clearTimeout(chunkFlushTimer)
    chunkFlushTimer = null
  }
  if (chunkQueue.length === 0) return
  const store = useConversationStore.getState()
  for (const c of chunkQueue) {
    if (c.type === 'text') {
      store.handleText(c.convId, c.messageId, c.content)
    } else {
      store.handleReasoning(c.convId, c.messageId, c.content)
    }
  }
  chunkQueue.length = 0
}

function enqueueChunk(convId: string, messageId: string, type: 'text' | 'reasoning', content: string) {
  const last = chunkQueue[chunkQueue.length - 1]
  if (last && last.convId === convId && last.messageId === messageId && last.type === type) {
    last.content += content
  } else {
    chunkQueue.push({ convId, messageId, type, content })
  }
  if (chunkFlushTimer === null) {
    chunkFlushTimer = setTimeout(flushChunks, CHUNK_FLUSH_MS)
  }
}

function shouldNotify(convId: string): boolean {
  const { activeId } = useConversationStore.getState()
  return !document.hasFocus() || convId !== activeId
}

function getConversationTitle(convId: string): string {
  const { conversations } = useConversationStore.getState()
  return conversations.find((c) => c.id === convId)?.title ?? 'Chat'
}

async function trySendNotification(title: string, body: string) {
  let granted = await isPermissionGranted()
  if (!granted) {
    const permission = await requestPermission()
    granted = permission === 'granted'
  }
  if (granted) {
    sendNotification({ title, body })
  }
}

export function useGlobalEventListener() {
  useEffect(() => {
    const chatStreamUnlisten = listen<StreamChunk>('chat-stream', (event) => {
      const p = event.payload
      const convId = p.conversation_id
      if (!convId) return

      if (p.type === 'text' && p.content) {
        enqueueChunk(convId, p.message_id!, 'text', p.content)
        return
      }

      if (p.type === 'reasoning' && p.content) {
        enqueueChunk(convId, p.message_id!, 'reasoning', p.content)
        return
      }

      // Control events must observe all buffered chunks to keep block order.
      flushChunks()
      const store = useConversationStore.getState()

      if (p.type === 'message_start' && p.message_id) {
        // A turn writes one of these per iteration; only the first starts the
        // clock. Turns that predate the id all share one key, which is the old
        // per-conversation behaviour.
        const streamKey = p.turn_id ?? convId
        if (!streamStartTimes.has(streamKey)) {
          streamStartTimes.set(streamKey, Date.now())
        }
        store.handleMessageStart(convId, p.message_id, p.turn_id)
        return
      }

      // Ahead of the backoff it describes, so the turn header can say what it is
      // waiting for rather than looking hung for the length of the wait. The
      // `reset` that follows marks the end of that wait and drops the partial
      // text; it is not what clears this.
      if (p.type === 'retry') {
        store.handleRetry(convId, p.attempt ?? 1, p.max_attempts ?? 0, p.delay_ms ?? 0)
        return
      }

      if (p.type === 'reset' && p.message_id) {
        store.handleStreamReset(convId, p.message_id)
        return
      }

      if (p.type === 'stop' || p.done) {
        const streamKey = p.turn_id ?? convId
        const startTime = streamStartTimes.get(streamKey)
        streamStartTimes.delete(streamKey)
        if (startTime && Date.now() - startTime > LONG_STREAM_THRESHOLD_MS && shouldNotify(convId)) {
          trySendNotification(getConversationTitle(convId), 'Response completed')
        }
        store.handleStop(convId, p.turn_id)
        return
      }

      if (p.type === 'tool_call' && p.call_id) {
        store.handleToolCall(convId, p.message_id!, p.call_id, p.tool_name!, p.arguments ?? '{}')
        return
      }

      // Without an approval_id there is nothing the buttons could answer with,
      // so the card would be decorative. Drop the event rather than draw one.
      if (p.type === 'tool_approval_req' && p.call_id && p.approval_id) {
        store.handleToolApproval(
          convId, p.message_id!, p.approval_id, p.call_id, p.tool_name!,
          p.retry_reason, p.origin_call_id,
          // Routed here rather than to the sub-agent's own conversation, which
          // is where the call is: nobody is necessarily looking at that one.
          p.parent_call_id
            ? {
              parentCallId: p.parent_call_id,
              arguments: p.arguments ?? '{}',
              subConversationId: p.sub_conversation_id,
            }
            : undefined,
        )
        if (shouldNotify(convId)) {
          const toolName = p.tool_name === 'ask_user' ? 'Question' : p.tool_name!
          trySendNotification(getConversationTitle(convId), `Action required: ${toolName}`)
        }
        return
      }

      if (
        p.type === 'sub_agent_started'
        && p.call_id && p.sub_conversation_id && p.spawned_turn_id
      ) {
        store.handleSubAgentStarted(convId, p.message_id!, p.call_id, {
          conversationId: p.sub_conversation_id,
          turnId: p.spawned_turn_id,
          kind: p.kind,
        })
        return
      }

      // message_id as well as call_id: provider call ids repeat, so the pair is
      // what identifies a card.
      if (p.type === 'tool_result' && p.call_id) {
        store.handleToolResult(convId, p.message_id!, p.call_id, p.result ?? '', p.outcome)
        return
      }
    })

    const convUpdatedUnlisten = listen('conversation-updated', () => {
      useConversationStore.getState().refreshConversations()
    })

    const compactStartUnlisten = listen<{ conversation_id: string }>('compact-start', (event) => {
      useConversationStore.getState().handleCompactStart(event.payload.conversation_id)
    })

    const compactDoneUnlisten = listen<{ conversation_id: string; error?: string; mid_turn?: boolean }>('compact-done', (event) => {
      const { conversation_id, error, mid_turn } = event.payload
      // A compaction that fails silently is indistinguishable from one that was
      // never attempted, while the context indicator stays pinned at its limit.
      if (error) useConversationStore.getState().setError(conversation_id, error)
      useConversationStore.getState().handleCompactDone(conversation_id, mid_turn)
    })

    return () => {
      chatStreamUnlisten.then((fn) => fn())
      convUpdatedUnlisten.then((fn) => fn())
      compactStartUnlisten.then((fn) => fn())
      compactDoneUnlisten.then((fn) => fn())
    }
  }, [])
}
