import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { ToastRegion } from '@/components/yuerchu-ui/components/toast/toast'
import { useUndoStore } from '@/stores/undo-store'
import { UNDO_MS, UndoToast } from './undo-toast'

describe('UndoToast', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    useUndoStore.setState({ pending: null, hidden: new Set() })
    render(
      <>
        <UndoToast />
        <ToastRegion />
      </>,
    )
  })
  afterEach(() => {
    // The toast queue is module state: one test's offer must not reach the next.
    act(() => {
      useUndoStore.setState({ pending: null })
    })
    vi.useRealTimers()
  })

  function offer(title = 'Plans') {
    const commit = vi.fn(() => Promise.resolve())
    const restore = vi.fn()
    act(() => useUndoStore.getState().offer({ conversationId: `c-${title}`, title, commit, restore }))
    return { commit, restore }
  }

  it('names what was deleted and deletes it when the offer runs out', () => {
    const { commit } = offer()
    expect(screen.getByText(i18n.t('notifications.undo.deleted', { title: 'Plans' }))).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(UNDO_MS - 300))
    expect(commit).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(400))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('puts it back on Undo, and never deletes it afterwards', () => {
    const { commit, restore } = offer()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.undo') }))
    expect(restore).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(UNDO_MS * 2))
    expect(commit).not.toHaveBeenCalled()
  })

  it('stands still while focus is inside it', () => {
    const { commit } = offer()
    act(() => screen.getByRole('button', { name: i18n.t('common.undo') }).focus())
    act(() => vi.advanceTimersByTime(UNDO_MS * 2))
    expect(commit).not.toHaveBeenCalled()
  })

  it('takes a second deletion into the same slot, deleting the first', async () => {
    const first = offer('Plans')
    const second = offer('Notes')
    // The store sends the first when the second takes the slot…
    expect(first.commit).toHaveBeenCalledTimes(1)
    // …and the one toast now names the second.
    expect(screen.getAllByText(/deleted/i)).toHaveLength(1)
    expect(screen.getByText(i18n.t('notifications.undo.deleted', { title: 'Notes' }))).toBeInTheDocument()
    // Sent one at a time (the store chains them), so the second goes a tick later.
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 200)
    })
    expect(second.commit).toHaveBeenCalledTimes(1)
    expect(first.commit).toHaveBeenCalledTimes(1)
  })

  it('goes away when the deletion is settled somewhere else', () => {
    offer()
    act(() => useUndoStore.getState().commit())
    expect(screen.queryByText(i18n.t('notifications.undo.deleted', { title: 'Plans' }))).not.toBeInTheDocument()
  })
})
