import { create } from 'zustand'

/**
 * A conversation deleted with a way back: gone from every list at once, and
 * actually deleted only when the offer runs out.
 *
 * Telegram's pattern. The row disappears on the press; the delete itself is
 * sent when the offer's notification times out, when it is closed, or when
 * another deletion takes the slot — there is one slot, so the previous offer is
 * committed rather than queued behind a second notification. Undo puts the row
 * back. Because nothing has been sent while the offer stands, quitting the app
 * in that window loses the deletion, not the conversation: the safe way to fail.
 *
 * A conversation stays hidden while its delete is in flight, too. Released at
 * the moment the offer is committed, it would reappear until the list was
 * refreshed and then vanish a second time. A delete that fails releases it, and
 * the caller's `commit` reports the failure.
 */
export interface UndoableDeletion {
  conversationId: string
  title: string | null
  /** Sends the delete. Runs at most once. */
  commit: () => Promise<void>
  /** Puts back anything that was moved away from on the press — the open conversation. */
  restore: () => void
}

interface UndoState {
  pending: UndoableDeletion | null
  /** Ids no list should show: the offer's, and every delete still in flight. */
  hidden: ReadonlySet<string>
  offer: (deletion: UndoableDeletion) => void
  undo: () => void
  commit: () => void
}

export const useUndoStore = create<UndoState>((set, get) => {
  const send = (deletion: UndoableDeletion) => {
    const release = () =>
      set((state) => {
        const hidden = new Set(state.hidden)
        hidden.delete(deletion.conversationId)
        return { hidden }
      })
    // The caller's commit reports its own failure; here it only decides when
    // the row may be shown again.
    deletion.commit().then(release, release)
  }

  return {
    pending: null,
    hidden: new Set(),
    offer: (deletion) => {
      const previous = get().pending
      set((state) => ({ pending: deletion, hidden: new Set(state.hidden).add(deletion.conversationId) }))
      if (previous) send(previous)
    },
    undo: () => {
      const pending = get().pending
      if (!pending) return
      set((state) => {
        const hidden = new Set(state.hidden)
        hidden.delete(pending.conversationId)
        return { pending: null, hidden }
      })
      pending.restore()
    },
    commit: () => {
      const pending = get().pending
      if (!pending) return
      set({ pending: null })
      send(pending)
    },
  }
})
