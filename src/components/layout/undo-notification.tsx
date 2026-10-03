import { createContext, useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Notification } from '@/components/base'
import { useUndoStore, type UndoableDeletion } from '@/stores/undo-store'
import { cx } from '@/utils/cx'

/** How long an undo offer stands, counted only while it can be seen and is not being read. */
export const UNDO_MS = 5000
const TICK_MS = 100

const SecondsLeft = createContext(0)

/** The seconds left, where the notification draws its icon — as Telegram draws its countdown. */
function CountdownGlyph({ className }: { className?: string }) {
  const seconds = useContext(SecondsLeft)
  return (
    <span aria-hidden className={cx(className, 'flex items-center justify-center text-body-medium tabular-nums')}>
      {seconds}
    </span>
  )
}

/**
 * Time left on a countdown that stands still while `paused`.
 *
 * Paused while the pointer is over the offer or focus is inside it — WCAG
 * 2.2.1: whoever is reaching for Undo must not lose it mid-reach — and while
 * the stack is hidden under a modal or behind the open inbox, where nobody can
 * reach it at all.
 */
function useCountdown(total: number, paused: boolean): number {
  const [left, setLeft] = useState(total)
  useEffect(() => {
    if (paused) return
    let last = performance.now()
    const timer = window.setInterval(() => {
      // Read before the update is queued: the updater runs at render, by
      // which time `last` has moved on.
      const now = performance.now()
      const step = now - last
      last = now
      setLeft((value) => Math.max(0, value - step))
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [paused])
  return left
}

/**
 * The undo offer for a conversation just deleted (`stores/undo-store.ts`), at
 * the head of the notification stack. Closing it deletes now; letting it run
 * out deletes then; Undo puts the conversation back.
 */
export function UndoNotification({ deletion, hidden }: { deletion: UndoableDeletion; hidden: boolean }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const left = useCountdown(UNDO_MS, hidden || hovered || focused)

  useEffect(() => {
    if (left === 0) useUndoStore.getState().commit()
  }, [left])

  return (
    <SecondsLeft value={Math.ceil(left / 1000)}>
      <Notification
        data-slot="undo-notification"
        title={t('notifications.undo.deleted', { title: deletion.title ?? t('sidebar.newChat') })}
        icon={CountdownGlyph}
        actions={[{ label: t('common.undo'), onPress: () => useUndoStore.getState().undo() }]}
        closeLabel={t('notifications.undo.deleteNow')}
        onDismiss={() => useUndoStore.getState().commit()}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
        }}
      />
    </SecondsLeft>
  )
}
