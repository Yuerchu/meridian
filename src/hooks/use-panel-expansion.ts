import { useCallback, useEffect, useRef, useState } from 'react'
import { useConversationStore } from '@/stores/conversation-store'
import { useTranscriptConversationId } from './use-transcript-conversation'

/**
 * Whether a keyboard panel is open: the reader's choice if they made one, the
 * automatic policy otherwise.
 *
 * Controlled rather than `defaultExpanded`, for two reasons that both come
 * down to timing. A panel opens while its call runs and closes when the result
 * lands — and it must open *again* if the call turns out to need a decision,
 * which a sandbox escalation does after the reader may already have closed
 * it. And the transcript is reloaded when a turn ends, which re-keys the rows
 * and remounts every panel; an uncontrolled panel re-evaluates its default at
 * that moment, so a whole turn's panels used to snap shut on reload rather
 * than on completion, one jump after another.
 *
 * The choice lives in the store, keyed by conversation and call, so it
 * survives that remount and switching conversations and back. `force` rising
 * clears it: a question arriving is a new reason to look, and a panel the
 * reader closed before it was asked is not a panel they chose to ignore.
 *
 * The conversation is the *transcript's*, not the window's — see
 * `useTranscriptConversationId`. A panel opened in the sub-agent sheet belongs
 * to the delegated run, and keying it by `activeId` wrote it to the outer
 * conversation, where a repeated provider call id could match a different tool
 * entirely.
 */
export function usePanelExpansion(
  key: string,
  auto: boolean,
  force: boolean,
): { isExpanded: boolean; onExpandedChange: (next: boolean) => void } {
  const conversationId = useTranscriptConversationId()
  const stored = useConversationStore((s) =>
    conversationId ? s.sessions[conversationId]?.expandedPanels[key] : undefined,
  )
  const setPanelExpanded = useConversationStore((s) => s.setPanelExpanded)
  // Outside a conversation — the playground — there is no session to keep the
  // choice in, so it is kept here instead.
  const [local, setLocal] = useState<boolean | null>(null)
  const choice = conversationId ? (stored ?? null) : local

  const wasForced = useRef(force)
  useEffect(() => {
    const rose = force && !wasForced.current
    wasForced.current = force
    if (!rose) return
    if (conversationId) setPanelExpanded(conversationId, key, null)
    else setLocal(null)
  }, [force, conversationId, key, setPanelExpanded])

  const onExpandedChange = useCallback(
    (next: boolean) => {
      if (conversationId) setPanelExpanded(conversationId, key, next)
      else setLocal(next)
    },
    [conversationId, key, setPanelExpanded],
  )

  return { isExpanded: choice ?? (force || auto), onExpandedChange }
}
