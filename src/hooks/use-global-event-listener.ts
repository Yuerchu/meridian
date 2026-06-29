import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { useConversationStore } from '@/stores/conversation-store'
import type { StreamChunk } from '@/types'

const streamStartTimes = new Map<string, number>()
const LONG_STREAM_THRESHOLD_MS = 30_000

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

      const store = useConversationStore.getState()

      if (p.type === 'message_start' && p.message_id) {
        if (!streamStartTimes.has(convId)) {
          streamStartTimes.set(convId, Date.now())
        }
        store.handleMessageStart(convId, p.message_id)
        return
      }

      if (p.type === 'stop' || p.done) {
        const startTime = streamStartTimes.get(convId)
        streamStartTimes.delete(convId)
        if (startTime && Date.now() - startTime > LONG_STREAM_THRESHOLD_MS && shouldNotify(convId)) {
          trySendNotification(getConversationTitle(convId), 'Response completed')
        }
        store.handleStop(convId)
        return
      }

      if (p.type === 'text' && p.content) {
        store.handleText(convId, p.message_id!, p.content)
        return
      }

      if (p.type === 'reasoning' && p.content) {
        store.handleReasoning(convId, p.message_id!, p.content)
        return
      }

      if (p.type === 'tool_call' && p.call_id) {
        store.handleToolCall(convId, p.message_id!, p.call_id, p.tool_name!, p.arguments ?? '{}')
        return
      }

      if (p.type === 'tool_approval_req' && p.call_id) {
        store.handleToolApproval(convId, p.message_id!, p.call_id, p.tool_name!, p.arguments ?? '{}')
        if (shouldNotify(convId)) {
          const toolName = p.tool_name === 'ask_user' ? 'Question' : p.tool_name!
          trySendNotification(getConversationTitle(convId), `Action required: ${toolName}`)
        }
        return
      }

      if (p.type === 'tool_result' && p.call_id) {
        store.handleToolResult(convId, p.call_id, p.result ?? '')
        return
      }
    })

    const convUpdatedUnlisten = listen('conversation-updated', () => {
      useConversationStore.getState().refreshConversations()
    })

    const compactStartUnlisten = listen<{ conversation_id: string }>('compact-start', (event) => {
      useConversationStore.getState().handleCompactStart(event.payload.conversation_id)
    })

    const compactDoneUnlisten = listen<{ conversation_id: string }>('compact-done', (event) => {
      useConversationStore.getState().handleCompactDone(event.payload.conversation_id)
    })

    return () => {
      chatStreamUnlisten.then((fn) => fn())
      convUpdatedUnlisten.then((fn) => fn())
      compactStartUnlisten.then((fn) => fn())
      compactDoneUnlisten.then((fn) => fn())
    }
  }, [])
}
