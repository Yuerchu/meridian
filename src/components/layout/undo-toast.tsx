import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { closeToast, toast } from '@/components/yuerchu-ui/components/toast/toast'
import { useUndoStore } from '@/stores/undo-store'

/** How long an undo offer stands. */
export const UNDO_MS = 5000

/** One slot: a second deletion replaces the offer in place rather than queueing beside it. */
const UNDO_TOAST_ID = 'undo-delete'

/**
 * The undo offer for a conversation just deleted (`stores/undo-store.ts`), as
 * the library's Toast. Undo puts the conversation back; closing the toast or
 * letting it run out deletes.
 *
 * The countdown, pausing under the pointer or focus, and standing still while
 * the window is hidden are the Toast's own. What it does not do is stand still
 * while a modal covers it or the inbox is open (Yuerchu/ui#588), so the offer
 * can run out where the reader cannot reach it. The deletion is then sent, as
 * it always was when the offer ran out.
 *
 * `commit` is safe to call after an undo: the store forgets what is pending
 * the moment it is undone, and `onClose` fires after `onAction` too.
 */
export function UndoToast() {
  const { t } = useTranslation()
  const pending = useUndoStore((s) => s.pending)
  const key = useRef<string | null>(null)

  useEffect(() => {
    if (!pending) {
      // Committed or undone from somewhere else: nothing left to offer.
      if (key.current !== null) closeToast(key.current)
      key.current = null
      return
    }
    key.current = toast({
      id: UNDO_TOAST_ID,
      title: t('notifications.undo.deleted', { title: pending.title ?? t('sidebar.newChat') }),
      action: { label: t('common.undo'), onAction: () => useUndoStore.getState().undo() },
      timeout: UNDO_MS,
      onClose: () => {
        key.current = null
        useUndoStore.getState().commit()
      },
    })
  }, [pending, t])

  return null
}
