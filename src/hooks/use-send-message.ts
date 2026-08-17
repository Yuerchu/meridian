import { useCallback, useEffect, useRef } from 'react'
import { api } from '@/api'
import { useConversationStore } from '@/stores/conversation-store'
import type { AttachedFile } from '@/components/chat/input-bar'
import type { ChatMode, ThinkingLevel } from '@/types'

/** The toolbar's answer to "how should this turn be sent", read at send time. */
export interface SendOptions {
  streaming: boolean
  selectedAssistantId: string | null
  selectedModelId: string | null
  selectedProviderId: string | null
  thinkingLevel: ThinkingLevel
  fastMode: boolean
  mode: ChatMode
}

export interface SendMessage {
  /**
   * @param text  `null` means "regenerate": no new wording, only a new answer.
   * @param replaces  Id of the message the new one is a sibling of.
   */
  sendMessage: (
    text: string | null,
    addUserBubble: boolean,
    files?: AttachedFile[],
    replaces?: string,
    voice?: boolean,
  ) => Promise<void>
  /** Says something to the run already going; false when nobody was reading. */
  steerMessage: (text: string) => Promise<boolean>
  handleRegenerate: (messageId: string) => void
  handleEdit: (id: string, content: string) => void
  handleVoiceSend: (text: string) => void
}

/**
 * The user's words on screen before any row exists for them.
 *
 * The id is temporary and the reload that follows the turn replaces the whole
 * list, so nothing here has to match what the backend will write — only to read
 * as what was typed.
 */
function appendTempUser(conversationId: string, content: string, now: number) {
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
              content,
              provider_id: null,
              model_id: null,
              input_tokens: null,
              output_tokens: null,
              cache_read_tokens: null,
              cache_write_tokens: null,
              provider_name: null,
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

/**
 * Sending a turn, and the three ways of re-sending one.
 *
 * The optimistic bookkeeping lives here too: the user's bubble appears before
 * the backend has acknowledged anything, and a replaced answer disappears
 * before its successor starts arriving. Both are undone by the reload that
 * follows a failure.
 */
export function useSendMessage(conversationId: string, opts: SendOptions): SendMessage {
  const storeBeginTurn = useConversationStore((s) => s.beginTurn)
  const storeAbortTurn = useConversationStore((s) => s.abortTurn)
  const storeLoadMessages = useConversationStore((s) => s.loadMessages)
  const storeSetError = useConversationStore((s) => s.setError)
  const submittingRef = useRef(false)

  const { streaming, selectedAssistantId, selectedModelId, selectedProviderId, thinkingLevel, fastMode, mode } = opts

  const sendMessage = useCallback(
    async (text: string | null, addUserBubble: boolean, files?: AttachedFile[], replaces?: string, voice?: boolean) => {
      // A null message means "regenerate", which needs no text of its own.
      if ((text === null ? !replaces : !text) || streaming || submittingRef.current) return
      submittingRef.current = true
      // Minted here, not by the backend, and handed to it. The composer locks on
      // this line; the backend's first event is several awaits away. Anything
      // arriving in between — most of all the previous turn's stop, which can be
      // delivered after its rejection has already unlocked the composer — has to
      // be measurable against an id that already exists.
      const turnId = crypto.randomUUID()
      storeBeginTurn(conversationId, turnId)
      const now = Date.now()

      let messageContent = text
      if (text !== null && files && files.length > 0) {
        try {
          const parts: unknown[] = [{ type: 'text', text }]
          parts.push(...(await Promise.all(files.map((f) => api.uploadFile(conversationId, f.path)))))
          messageContent = JSON.stringify(parts)
        } catch (err) {
          storeAbortTurn(conversationId, turnId, String(err))
          submittingRef.current = false
          return
        }
      }

      // Drop the version being replaced before the new one starts arriving. It is
      // still on screen at this point, and everything after it on the path is its
      // descendant, so without this the old answer sits above the new one as it
      // streams in. The rows survive in the database; the reload on stop brings
      // back whatever the active path turns out to be, and the catch below
      // restores them if the request never lands.
      if (replaces) {
        useConversationStore.setState((state) => {
          const session = state.sessions[conversationId]
          if (!session) return state
          const idx = session.messages.findIndex((m) => m.id === replaces)
          if (idx < 0) return state
          return {
            sessions: {
              ...state.sessions,
              [conversationId]: { ...session, messages: session.messages.slice(0, idx) },
            },
          }
        })
      }

      if (addUserBubble && messageContent !== null) {
        appendTempUser(conversationId, messageContent, now)
      }

      api
        .chat(conversationId, messageContent, {
          turnId,
          replaces,
          modelOverride: selectedModelId ?? undefined,
          providerOverride: selectedProviderId ?? undefined,
          thinkingLevel: thinkingLevel !== 'default' ? thinkingLevel : undefined,
          assistantId: selectedAssistantId ?? undefined,
          fast: fastMode || undefined,
          mode,
          voice: voice || undefined,
        })
        .catch((err) => {
          // Message and all, by id: a rejection can land after the user has given
          // up and resent, and it must neither unlock the composer on the turn
          // that replaced it nor report its failure against it.
          storeAbortTurn(conversationId, turnId, String(err))
          submittingRef.current = false
          storeLoadMessages(conversationId)
        })
    },
    [
      conversationId,
      streaming,
      selectedModelId,
      selectedProviderId,
      thinkingLevel,
      fastMode,
      mode,
      selectedAssistantId,
      storeBeginTurn,
      storeAbortTurn,
      storeLoadMessages,
    ],
  )

  /**
   * Say something to a run that is already going.
   *
   * Not a turn, and so not `sendMessage`: it starts nothing, takes no lease and
   * leaves `submittingRef`, the streaming flag and the assistant bubble exactly
   * where they were. The backend drops the text into the run's inbox and the
   * loop takes it between rounds.
   *
   * The bubble waits for the answer rather than going up first. A refusal means
   * nobody was reading — the run had already stopped — and the backend
   * deliberately writes nothing in that case, so a bubble put up optimistically
   * would be a message on screen that exists nowhere and will not come back
   * after a reload. The round trip is local and the text stays in the field
   * until it lands, which is what makes resending it a matter of pressing Enter
   * again.
   */
  const steerMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return false
      try {
        await api.steerConversation(conversationId, trimmed)
      } catch (err) {
        storeSetError(conversationId, String(err))
        return false
      }
      storeSetError(conversationId, null)
      appendTempUser(conversationId, trimmed, Date.now())
      return true
    },
    [conversationId, storeSetError],
  )

  // Reset submittingRef when streaming ends
  useEffect(() => {
    if (!streaming) {
      submittingRef.current = false
    }
  }, [streaming])

  // Adds an answer beside the existing one instead of destroying it. This used
  // to delete the question and everything after it, then re-send — the old
  // answer was simply gone.
  const handleRegenerate = useCallback(
    (messageId: string) => {
      sendMessage(null, false, undefined, messageId)
    },
    [sendMessage],
  )

  // Editing forks rather than overwrites: the question is re-asked as a sibling
  // of the original and answered fresh, leaving the old wording and its answer
  // reachable through the pager.
  const handleEdit = useCallback(
    (id: string, content: string) => {
      sendMessage(content, true, undefined, id)
    },
    [sendMessage],
  )

  // Voice input sends directly, bypassing the textarea and any attachments.
  const handleVoiceSend = useCallback(
    (text: string) => {
      if (text.trim()) sendMessage(text, true, undefined, undefined, true)
    },
    [sendMessage],
  )

  return { sendMessage, steerMessage, handleRegenerate, handleEdit, handleVoiceSend }
}
