import { useCallback, useEffect, useState } from 'react'

import { api } from '@/api'
import { listen } from '@/lib/transport'
import type { QueueDelivery, QueueState, QueuedPrompt, WorkspaceReferenceInput } from '@/types'

/**
 * The state a row is in, derived here from the same timestamps the backend
 * derives it from.
 *
 * Duplicated rather than sent as a field on purpose: the row already carries
 * every timestamp, and a status column beside them would be a second answer
 * that could disagree after a partial write. The order matters — settled
 * outranks everything, then in-doubt, which must never be mistaken for
 * deliverable.
 */
export function queueState(item: QueuedPrompt): QueueState {
  if (item.settled_at != null) return 'settled'
  if (item.dispatched_at != null) return 'in_doubt'
  if (item.held_at != null) return 'held'
  return 'queued'
}

/**
 * The messages stacked up for a conversation, and how to change them.
 *
 * Read back from the backend on every change rather than kept in step here.
 * The queue moves without anyone touching this window — a turn ending delivers
 * the next item, a steer settles one — and a copy maintained locally would
 * disagree with the ledger at exactly the moments the ledger exists for.
 *
 * `queue-updated` carries nothing but a conversation id for the same reason.
 */
export function usePromptQueue(conversationId: string, enabled: boolean) {
  const [items, setItems] = useState<QueuedPrompt[]>([])

  const reload = useCallback(() => {
    if (!enabled) return
    api
      .queueList(conversationId)
      .then(setItems)
      .catch(() => {})
  }, [conversationId, enabled])

  useEffect(() => {
    if (!enabled) {
      setItems([])
      return
    }
    let alive = true
    api
      .queueList(conversationId)
      .then((next) => {
        if (alive) setItems(next)
      })
      .catch(() => {
        if (alive) setItems([])
      })
    const unlisten = listen<{ conversation_id?: string }>('queue-updated', (event) => {
      if (event.payload?.conversation_id !== conversationId) return
      if (!alive) return
      api
        .queueList(conversationId)
        .then((next) => {
          if (alive) setItems(next)
        })
        .catch(() => {})
    })
    return () => {
      alive = false
      void unlisten.then((off) => off())
    }
  }, [conversationId, enabled])

  const enqueue = useCallback(
    async (content: string, delivery: QueueDelivery, contextRefs?: WorkspaceReferenceInput[]) => {
      const item = await api.queueEnqueue(conversationId, content, delivery, contextRefs)
      // Optimistic only in the sense that it saves a round trip; the event that
      // follows replaces the list wholesale, including this row.
      setItems((prev) => [...prev, item])
      return item
    },
    [conversationId],
  )

  const remove = useCallback(
    async (id: string) => {
      // Refused for anything already sent, and the refusal is the point: the
      // list is redrawn from what the backend actually has rather than from
      // what was asked for.
      await api.queueRemove(conversationId, id).finally(reload)
    },
    [conversationId, reload],
  )

  const reorder = useCallback(
    async (next: QueuedPrompt[]) => {
      // Drawn immediately, because a row that snaps back while a request is in
      // flight reads as the drag having failed.
      setItems(next)
      await api
        .queueReorder(
          conversationId,
          next.map((i) => i.id),
        )
        .catch(reload)
    },
    [conversationId, reload],
  )

  const setDelivery = useCallback(
    async (id: string, delivery: QueueDelivery) => {
      await api.queueSetDelivery(conversationId, id, delivery).finally(reload)
    },
    [conversationId, reload],
  )

  const release = useCallback(async () => {
    await api.queueRelease(conversationId).finally(reload)
  }, [conversationId, reload])

  // A settled row leaves the list once the message it became exists, and not
  // before. The two are the same instant for a follow-up — one transaction
  // writes the row and settles the item — and can be minutes apart for a steer:
  // the agent acknowledges it at once, while the transcript row waits for the
  // running turn's next round boundary, which is however long the tool call in
  // flight takes. Dropping it on `settled_at` alone puts the message nowhere
  // the user can see it for that whole time.
  const pending = items.filter((i) => queueState(i) !== 'settled' || i.settled_message_id == null)
  return {
    items: pending,
    held: pending.some((i) => queueState(i) === 'held'),
    enqueue,
    remove,
    reorder,
    setDelivery,
    release,
  }
}
