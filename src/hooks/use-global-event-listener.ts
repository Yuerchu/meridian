import { useEffect } from 'react'
import { listen } from '@/lib/transport'
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

/**
 * A provider-side call's result, in the shape the card that draws it expects.
 *
 * `web_search` routes to `WebSearchBlock`, whose `parseWebSearchResult` accepts
 * one thing: `{"sources": [{title, url, content}]}`. Anything else it reads as a
 * raw error string and draws in red as "search failed" — so handing it a plain
 * list of URLs turned *every successful* provider search into a visible failure.
 *
 * The upstream itemises URLs and nothing else, so the host stands in for a
 * title. It can be a relative path (`/question/what-is-xai` has been seen in a
 * live response), which is why this cannot just be `new URL(...).hostname`.
 */
function serverToolResult(call: NonNullable<StreamChunk['call']>): string {
  return JSON.stringify({
    sources: call.sources.map((url) => ({
      title: url.replace(/^https?:\/\//, '').replace(/^www\./, '') || url,
      url,
      content: '',
    })),
  })
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

      // A tool the provider ran on its own side — Grok's web search, DeepSeek's.
      // Drawn as an ordinary tool card, which is what it is minus the part where
      // we run it: without one the reader gets a minute of silence and then an
      // answer out of nowhere.
      //
      // Announced twice under one id. The query and the sources only exist on
      // the second, so the first opens the card and the second revises it and
      // closes it out — there is no result event coming, because nothing here is
      // waiting to be executed.
      if (p.type === 'server_tool' && p.message_id && p.call) {
        const call = p.call
        const args = call.arguments ?? '{}'
        if (call.completed) {
          store.reviseToolCall(convId, p.message_id, call.id, call.name, args)
          store.handleToolResult(convId, p.message_id, call.id, serverToolResult(call))
        } else {
          store.handleToolCall(convId, p.message_id, call.id, call.name, args)
        }
        return
      }

      // Somebody's queued interjection reaching the agent mid-turn. Written by
      // the runner rather than the composer, so this window may never have seen
      // it before — it can have been typed on the phone.
      if (p.type === 'user_message' && p.message_id) {
        store.handleUserMessage(convId, p.message_id, p.content ?? '')
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
          convId,
          p.message_id!,
          p.approval_id,
          p.call_id,
          p.tool_name!,
          // Sent with every approval, not just a delegated one. It used to be
          // read only out of the `parent_call_id` branch, which was enough while
          // the only reader was a card sitting on a row it could not reach — the
          // queue needs it for all of them, and for the same reason: it draws
          // outside any transcript.
          p.arguments ?? '{}',
          p.retry_reason,
          p.origin_call_id,
          // Routed here rather than to the sub-agent's own conversation, which
          // is where the call is: nobody is necessarily looking at that one.
          p.parent_call_id ? { parentCallId: p.parent_call_id, subConversationId: p.sub_conversation_id } : undefined,
        )
        if (shouldNotify(convId)) {
          const toolName = p.tool_name === 'ask_user' ? 'Question' : p.tool_name!
          trySendNotification(getConversationTitle(convId), `Action required: ${toolName}`)
        }
        return
      }

      // The deadline passed with nobody answering. The turn is still running —
      // this is not a stop — so nothing else would ever take the card down, and
      // its buttons already reach a receiver that has gone.
      if (p.type === 'tool_approval_expired' && p.approval_id) {
        store.handleApprovalExpired(convId, p.approval_id)
        return
      }

      if (p.type === 'sub_agent_started' && p.call_id && p.sub_conversation_id && p.spawned_turn_id) {
        store.handleSubAgentStarted(convId, p.message_id!, p.call_id, {
          conversationId: p.sub_conversation_id,
          turnId: p.spawned_turn_id,
          kind: p.kind,
        })
        return
      }

      // A call the reviewer decided instead of the user. No notification: the
      // point of the feature is not interrupting anybody, and the verdict is
      // on the card either way.
      if (p.type === 'auto_review' && p.call_id && p.message_id && p.verdict) {
        store.handleAutoReview(convId, p.message_id, p.call_id, p.verdict)
        return
      }

      // A call that was drawn before it knew its own arguments. Only a hosted
      // ACP session sends this: its call ids are unique within a session, which
      // is what makes "the same card again" a safe thing to say.
      if (p.type === 'tool_call_revised' && p.call_id) {
        store.reviseToolCall(convId, p.message_id!, p.call_id, p.tool_name!, p.arguments ?? '{}')
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

    // Synthesised by the transport when a dropped connection comes back. Not a
    // backend event: nothing was replayed, which is the whole reason this
    // exists. Whatever happened while the socket was down has to be read off
    // the server rather than waited for.
    const resyncUnlisten = listen('remote-resync', () => {
      useConversationStore.getState().resyncAfterReconnect()
      // Approvals are not in the transcript the resync above re-reads, and the
      // events that announced them went out while the socket was down.
      useConversationStore.getState().loadAllPending()
    })

    // What was already waiting before this client existed. A window that
    // reloaded and a phone that has just connected are the same case: the turn
    // is still open in the backend and its question was announced once, to
    // nobody.
    useConversationStore.getState().loadAllPending()

    const compactStartUnlisten = listen<{ conversation_id: string }>('compact-start', (event) => {
      useConversationStore.getState().handleCompactStart(event.payload.conversation_id)
    })

    const compactDoneUnlisten = listen<{ conversation_id: string; error?: string; mid_turn?: boolean }>(
      'compact-done',
      (event) => {
        const { conversation_id, error, mid_turn } = event.payload
        // A compaction that fails silently is indistinguishable from one that was
        // never attempted, while the context indicator stays pinned at its limit.
        if (error) useConversationStore.getState().setError(conversation_id, error)
        useConversationStore.getState().handleCompactDone(conversation_id, mid_turn)
      },
    )

    return () => {
      chatStreamUnlisten.then((fn) => fn())
      convUpdatedUnlisten.then((fn) => fn())
      resyncUnlisten.then((fn) => fn())
      compactStartUnlisten.then((fn) => fn())
      compactDoneUnlisten.then((fn) => fn())
    }
  }, [])
}
