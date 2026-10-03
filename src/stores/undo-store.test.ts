import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUndoStore, type UndoableDeletion } from './undo-store'

function deletion(conversationId: string, commit: () => Promise<void> = () => Promise.resolve()) {
  return { conversationId, title: null, commit: vi.fn(commit), restore: vi.fn() } satisfies UndoableDeletion
}

const state = () => useUndoStore.getState()

describe('undo store', () => {
  beforeEach(() => useUndoStore.setState({ pending: null, hidden: new Set() }))

  it('hides an offered conversation and sends nothing yet', () => {
    const d = deletion('a')
    state().offer(d)
    expect(state().hidden.has('a')).toBe(true)
    expect(d.commit).not.toHaveBeenCalled()
  })

  it('puts it back on undo, and never sends it', () => {
    const d = deletion('a')
    state().offer(d)
    state().undo()
    expect(state().pending).toBeNull()
    expect(state().hidden.has('a')).toBe(false)
    expect(d.restore).toHaveBeenCalledTimes(1)
    expect(d.commit).not.toHaveBeenCalled()
  })

  it('keeps it hidden while the delete is in flight, then lets go', async () => {
    let finish!: () => void
    const d = deletion('a', () => new Promise<void>((resolve) => (finish = resolve)))
    state().offer(d)
    state().commit()
    expect(d.commit).toHaveBeenCalledTimes(1)
    expect(state().pending).toBeNull()
    expect(state().hidden.has('a')).toBe(true)
    finish()
    await vi.waitFor(() => expect(state().hidden.has('a')).toBe(false))
  })

  it('shows it again when the delete fails', async () => {
    const d = deletion('a', () => Promise.reject(new Error('locked')))
    state().offer(d)
    state().commit()
    await vi.waitFor(() => expect(state().hidden.has('a')).toBe(false))
  })

  it('commits the standing offer when a second deletion takes the slot', () => {
    const first = deletion('a')
    const second = deletion('b')
    state().offer(first)
    state().offer(second)
    expect(first.commit).toHaveBeenCalledTimes(1)
    expect(state().pending).toBe(second)
    expect([...state().hidden].sort()).toEqual(['a', 'b'])
  })

  it('sends one delete at a time, so their list refreshes cannot cross', async () => {
    let finishFirst!: () => void
    const first = deletion('a', () => new Promise<void>((resolve) => (finishFirst = resolve)))
    const second = deletion('b')
    state().offer(first)
    state().offer(second)
    state().commit()
    expect(first.commit).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(second.commit).not.toHaveBeenCalled()
    finishFirst()
    await vi.waitFor(() => expect(second.commit).toHaveBeenCalledTimes(1))
  })
})
