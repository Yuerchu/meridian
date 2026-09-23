/**
 * "Take me to the card this conversation is waiting on", from outside the
 * transcript.
 *
 * The header's inbox leaves the conversation being read out of its list — its
 * cards are in the transcript already — and says only how many there are. Its
 * button has to move a scroller it cannot reach: `scrollToMessage` lives in the
 * transcript's `MessageScrollerProvider`, below the shell. So the request is a
 * broadcast, and the transcript drawing that conversation answers it
 * (`PendingReveal` in `chat-transcript.tsx`). A transcript for another
 * conversation — the sub-agent sheet draws one — ignores it.
 *
 * A module rather than a store field: it is an event, not state, and a field
 * would have to be cleared by whoever consumed it.
 */
type Listener = (conversationId: string) => void

const listeners = new Set<Listener>()

export function requestPendingReveal(conversationId: string): void {
  for (const listener of listeners) listener(conversationId)
}

export function onPendingReveal(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
