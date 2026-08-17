import { useConversationStore } from '@/stores/conversation-store'

/**
 * A dot on a conversation the reader is not currently looking at.
 *
 * Shared by the desktop sidebar and the mobile list: the precedence below is a
 * product rule, and two copies of it would drift.
 */
export function ConversationIndicator({
  conversationId,
  activeId,
}: {
  conversationId: string
  activeId: string | null
}) {
  const session = useConversationStore((s) => s.sessions[conversationId])
  if (!session || conversationId === activeId) return null

  // Key counts, not truthiness: these are records now, and an empty one is
  // still an object.
  if (Object.keys(session.pendingApprovals).length > 0 || Object.keys(session.pendingAsks).length > 0) {
    return <span className="size-2 shrink-0 rounded-full bg-warning animate-pulse" />
  }
  if (session.streaming) {
    return <span className="size-2 shrink-0 rounded-full bg-info animate-pulse" />
  }
  if (session.fulfilledUnseen) {
    return <span className="size-2 shrink-0 rounded-full bg-success" />
  }
  return null
}
