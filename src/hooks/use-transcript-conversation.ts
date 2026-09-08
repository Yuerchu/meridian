import { createContext, useContext } from 'react'
import { useConversationStore } from '@/stores/conversation-store'

/**
 * Which conversation the transcript around you is drawing.
 *
 * Everything under a transcript that keeps per-conversation state used to ask
 * the store for `activeId` — the conversation the *window* is on — which is the
 * same answer as long as there is only ever one transcript on screen. The
 * sub-agent sheet broke that: it draws a delegated run's own conversation
 * beside the one the window is on, so a panel opened in the sheet was written
 * to the outer conversation's `expandedPanels`, and the delegated run never
 * kept its own choice.
 *
 * Worse than losing the choice: the key is the provider's call id, and those
 * repeat across conversations — a gateway that restarts them at `"0"` within a
 * turn is the case the store's own comments call out. So opening a panel in the
 * sheet could open or close an unrelated tool in the transcript underneath it.
 *
 * `ChatTranscript` provides this; `activeId` remains the fallback, for the
 * composer and anything else outside a transcript. A playground with neither
 * gets `null` and keeps its state locally, exactly as before.
 */
const TranscriptConversationContext = createContext<string | null>(null)

export const TranscriptConversationProvider = TranscriptConversationContext.Provider

export function useTranscriptConversationId(): string | null {
  const fromTranscript = useContext(TranscriptConversationContext)
  const activeId = useConversationStore((s) => s.activeId)
  return fromTranscript ?? activeId
}
