import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { useUndoStore } from '@/stores/undo-store'
import { UNDO_MS, UndoNotification } from './undo-notification'

describe('UndoNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
    useUndoStore.setState({ pending: null, hidden: new Set() })
  })
  afterEach(() => vi.useRealTimers())

  function offer(hidden = false) {
    const commit = vi.fn(() => Promise.resolve())
    const restore = vi.fn()
    useUndoStore.getState().offer({ conversationId: 'c-1', title: 'Plans', commit, restore })
    const view = render(<UndoNotification deletion={useUndoStore.getState().pending!} hidden={hidden} />)
    return { commit, restore, view }
  }

  it('names what was deleted and deletes it when the offer runs out', () => {
    const { commit } = offer()
    expect(screen.getByText(i18n.t('notifications.undo.deleted', { title: 'Plans' }))).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(UNDO_MS - 300))
    expect(commit).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(400))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('puts it back on Undo', () => {
    const { commit, restore } = offer()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.undo') }))
    expect(restore).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(UNDO_MS * 2))
    expect(commit).not.toHaveBeenCalled()
  })

  it('stands still while the pointer is on it, then carries on', () => {
    const { commit } = offer()
    const card = document.querySelector('[data-slot="undo-notification"]')!
    act(() => vi.advanceTimersByTime(1000))
    fireEvent.pointerEnter(card)
    act(() => vi.advanceTimersByTime(UNDO_MS * 2))
    expect(commit).not.toHaveBeenCalled()
    fireEvent.pointerLeave(card)
    act(() => vi.advanceTimersByTime(UNDO_MS - 1000 + 200))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('stands still while focus is inside it', () => {
    const { commit } = offer()
    act(() => screen.getByRole('button', { name: i18n.t('common.undo') }).focus())
    act(() => vi.advanceTimersByTime(UNDO_MS * 2))
    expect(commit).not.toHaveBeenCalled()
  })

  it('stands still while the stack is hidden', () => {
    const { commit } = offer(true)
    act(() => vi.advanceTimersByTime(UNDO_MS * 2))
    expect(commit).not.toHaveBeenCalled()
  })
})
