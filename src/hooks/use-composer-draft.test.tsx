import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/api'
import { resetComposerDraftSync } from '@/lib/composer-draft-sync'
import i18n from '@/i18n'
import type { ComposerDraftInfoResponse, ComposerDraftWriteResponse } from '@/types'
import { COMPOSER_DRAFT_DEBOUNCE_MS, useComposerDraft, type ComposerDraftState } from './use-composer-draft'

vi.mock('@/api', () => ({
  api: {
    getComposerDraft: vi.fn(),
    saveComposerDraft: vi.fn(),
    clearComposerDraft: vi.fn(),
  },
}))

vi.mock('@/lib/sticker-urls', () => ({
  loadStickerUrl: vi.fn(() => Promise.resolve('asset://sticker')),
}))

const CONV = 'conv-1'

const EMPTY: ComposerDraftState = { text: '', attachedFiles: [], pendingSticker: null, conversationRefs: [] }

function state(text: string, over: Partial<ComposerDraftState> = {}): ComposerDraftState {
  return { ...EMPTY, text, ...over }
}

function stored(body: string, revision = 3, over: Partial<ComposerDraftInfoResponse> = {}): ComposerDraftInfoResponse {
  return {
    conversation_id: CONV,
    body,
    attachments: [],
    conversation_refs: [],
    sticker: null,
    revision,
    updated_at: 0,
    ...over,
  }
}

function applied(revision: number): ComposerDraftWriteResponse {
  return { applied: true, revision }
}

/** A promise settled by hand, for a read that has not come back yet. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Let queued promise callbacks run without moving fake time. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

function mount(initial: ComposerDraftState, conversationId: string | null = CONV) {
  const onRestore = vi.fn()
  const view = renderHook(({ s }) => useComposerDraft(conversationId, s, onRestore), {
    initialProps: { s: initial },
  })
  return { ...view, onRestore }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  resetComposerDraftSync()
  vi.mocked(api.saveComposerDraft).mockImplementation((request) => Promise.resolve(applied(request.revision)))
  vi.mocked(api.clearComposerDraft).mockImplementation((request) => Promise.resolve(applied(request.revision)))
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * The race that loses a draft. The composer mounts empty and the stored draft
 * arrives a moment later; anything written in between — the empty composer, a
 * re-render — would delete the draft before it is shown. Nothing may be
 * written until the read is back.
 */
test('writes nothing before the stored draft has been read, then restores it', async () => {
  const read = deferred<ComposerDraftInfoResponse | null>()
  vi.mocked(api.getComposerDraft).mockReturnValue(read.promise)

  const { rerender, onRestore } = mount(EMPTY)
  // Re-renders with the same empty state, and time passing, while the read is out.
  rerender({ s: { ...EMPTY } })
  await act(async () => {
    vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS * 3)
  })
  expect(api.saveComposerDraft).not.toHaveBeenCalled()
  expect(api.clearComposerDraft).not.toHaveBeenCalled()

  read.resolve(stored('half a thought'))
  await settle()
  expect(onRestore).toHaveBeenCalledWith(state('half a thought'))
  // Restoring is not a change to write back.
  rerender({ s: state('half a thought') })
  await act(async () => {
    vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS * 2)
  })
  expect(api.saveComposerDraft).not.toHaveBeenCalled()
  expect(api.clearComposerDraft).not.toHaveBeenCalled()
})

/** Typing that beat the read is newer than anything stored, and is kept. */
test('text typed before the read returns wins over the stored draft', async () => {
  const read = deferred<ComposerDraftInfoResponse | null>()
  vi.mocked(api.getComposerDraft).mockReturnValue(read.promise)

  const { rerender, onRestore } = mount(EMPTY)
  rerender({ s: state('typed quickly') })
  read.resolve(stored('older draft', 4))
  await settle()

  expect(onRestore).not.toHaveBeenCalled()
  expect(api.saveComposerDraft).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.saveComposerDraft).mock.calls[0][0]).toMatchObject({
    conversationId: CONV,
    body: 'typed quickly',
    revision: 5,
  })
})

/** A burst of keystrokes is one write, of the last state, after the pause. */
test('debounces a burst into one write of the latest text', async () => {
  vi.mocked(api.getComposerDraft).mockResolvedValue(null)
  const { rerender } = mount(EMPTY)
  await settle()

  for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
    rerender({ s: state(text) })
    await act(async () => {
      vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS - 100)
    })
  }
  expect(api.saveComposerDraft).not.toHaveBeenCalled()

  await act(async () => {
    vi.advanceTimersByTime(100)
  })
  await settle()
  expect(api.saveComposerDraft).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.saveComposerDraft).mock.calls[0][0]).toMatchObject({ body: 'hello', revision: 1 })
})

/** Switching conversation unmounts the composer; the pending write goes now. */
test('flushes a pending write on unmount', async () => {
  vi.mocked(api.getComposerDraft).mockResolvedValue(null)
  const { rerender, unmount } = mount(EMPTY)
  await settle()

  rerender({ s: state('about to switch away') })
  unmount()
  await settle()
  expect(api.saveComposerDraft).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.saveComposerDraft).mock.calls[0][0]).toMatchObject({ body: 'about to switch away' })
})

/**
 * Coming straight back must read what the unmount wrote, not race it: the
 * read waits for that slot's writes.
 */
test('a remount reads after the flush it follows', async () => {
  const save = deferred<ComposerDraftWriteResponse>()
  vi.mocked(api.getComposerDraft).mockResolvedValue(null)
  const first = mount(EMPTY)
  await settle()
  vi.mocked(api.saveComposerDraft).mockReturnValueOnce(save.promise)
  first.rerender({ s: state('left behind') })
  first.unmount()
  await settle()

  vi.mocked(api.getComposerDraft).mockClear()
  mount(EMPTY)
  await settle()
  expect(api.getComposerDraft).not.toHaveBeenCalled()
  save.resolve(applied(1))
  await settle()
  expect(api.getComposerDraft).toHaveBeenCalledTimes(1)
})

/**
 * Every send path empties the text. That is written at once, so a crash a
 * moment after sending cannot bring the sent text back as a draft.
 */
test('emptying the text after a send clears the draft immediately', async () => {
  vi.mocked(api.getComposerDraft).mockResolvedValue(stored('send me', 2))
  const { rerender } = mount(EMPTY)
  await settle()
  rerender({ s: state('send me') })

  rerender({ s: EMPTY })
  await settle()
  expect(api.clearComposerDraft).toHaveBeenCalledWith({ conversationId: CONV, revision: 3 })
  expect(api.saveComposerDraft).not.toHaveBeenCalled()
})

/** The queue path clears only the text; the attachment is still the draft. */
test('emptying only the text writes what is left at once', async () => {
  vi.mocked(api.getComposerDraft).mockResolvedValue(null)
  const file = { path: '/work/a.txt', name: 'a.txt' }
  const { rerender } = mount(EMPTY)
  await settle()
  rerender({ s: state('queued', { attachedFiles: [file] }) })
  rerender({ s: state('', { attachedFiles: [file] }) })
  await settle()
  expect(api.saveComposerDraft).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.saveComposerDraft).mock.calls[0][0]).toMatchObject({ body: '', attachments: [file] })
})

/** A failed write is shown, and the next change writes again. */
test('a failed write is reported and retried by the next change', async () => {
  vi.mocked(api.getComposerDraft).mockResolvedValue(null)
  vi.mocked(api.saveComposerDraft).mockRejectedValueOnce('database is locked')
  const { rerender, result } = mount(EMPTY)
  await settle()

  rerender({ s: state('first') })
  await act(async () => {
    vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS)
  })
  await settle()
  expect(result.current.error).toEqual({ kind: 'save', message: 'database is locked' })

  rerender({ s: state('first!') })
  await act(async () => {
    vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS)
  })
  await settle()
  expect(api.saveComposerDraft).toHaveBeenCalledTimes(2)
  expect(vi.mocked(api.saveComposerDraft).mock.calls[1][0]).toMatchObject({ body: 'first!' })
  expect(result.current.error).toBeNull()
})

/**
 * Another window or device wrote this draft since it was read here. The
 * write is retried once above the revision that won.
 */
test('a refused revision is retried above the winner', async () => {
  vi.mocked(api.getComposerDraft).mockResolvedValue(null)
  vi.mocked(api.saveComposerDraft).mockResolvedValueOnce({ applied: false, revision: 9 })
  const { rerender } = mount(EMPTY)
  await settle()
  rerender({ s: state('mine') })
  await act(async () => {
    vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS)
  })
  await settle()
  expect(vi.mocked(api.saveComposerDraft).mock.calls.map(([r]) => r.revision)).toEqual([1, 10])
})

/**
 * A browser `File` and an Android `content://` grant die with the page; only
 * an absolute path is offered to the host. A restored file that has gone is
 * marked rather than dropped.
 */
test('only reopenable attachments are written, and a vanished one comes back marked', async () => {
  vi.mocked(api.getComposerDraft).mockResolvedValue(null)
  const { rerender } = mount(EMPTY)
  await settle()
  rerender({
    s: state('files', {
      attachedFiles: [
        { path: 'C:\\work\\a.txt', name: 'a.txt' },
        { path: 'content://media/1', name: 'photo.jpg' },
        { name: 'dropped.png', file: new File(['x'], 'dropped.png') },
      ],
    }),
  })
  await act(async () => {
    vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS)
  })
  await settle()
  expect(vi.mocked(api.saveComposerDraft).mock.calls[0][0].attachments).toEqual([
    { path: 'C:\\work\\a.txt', name: 'a.txt' },
  ])

  resetComposerDraftSync()
  vi.mocked(api.getComposerDraft).mockResolvedValue(
    stored('files', 2, {
      attachments: [{ path: 'C:\\work\\a.txt', name: 'a.txt', exists: false }],
      conversation_refs: [{ id: 'other', title: null, exists: false }],
    }),
  )
  const again = mount(EMPTY)
  await settle()
  expect(again.onRestore).toHaveBeenCalledWith(
    state('files', {
      attachedFiles: [{ path: 'C:\\work\\a.txt', name: 'a.txt', missing: true }],
      conversationRefs: [{ id: 'other', title: '', missing: true }],
    }),
  )
})

/** The welcome composer has its own slot and can be cleared once it became a conversation. */
test('the welcome slot is cleared without its state changing', async () => {
  vi.mocked(api.getComposerDraft).mockResolvedValue(null)
  const { rerender, result, unmount } = mount(EMPTY, null)
  await settle()
  rerender({ s: state('first question') })
  act(() => result.current.clear())
  unmount()
  await settle()
  expect(api.saveComposerDraft).not.toHaveBeenCalled()
  expect(api.clearComposerDraft).toHaveBeenCalledWith({ conversationId: null, revision: 1 })
})

/**
 * A draft that could not be *read* was reported as one that could not be
 * saved. The read failure is its own kind; the composer's text is left alone.
 */
test('a failed read is reported as a failed read', async () => {
  vi.mocked(api.getComposerDraft).mockRejectedValueOnce('database is locked')
  const { result } = mount(EMPTY)
  await settle()
  expect(result.current.error).toEqual({ kind: 'load', message: 'database is locked' })
  act(() => result.current.dismissError())
  expect(result.current.error).toBeNull()
})

/**
 * Losing the race twice is thrown from the write's success handler. As the
 * second argument to the same `.then` the rejection handler never saw that
 * throw, so the conflict became an unhandled rejection and was said nowhere.
 */
test('a write that loses the race twice is reported, not dropped', async () => {
  vi.mocked(api.getComposerDraft).mockResolvedValue(null)
  vi.mocked(api.saveComposerDraft)
    .mockResolvedValueOnce({ applied: false, revision: 9 })
    .mockResolvedValueOnce({ applied: false, revision: 11 })
  const { rerender, result } = mount(EMPTY)
  await settle()
  rerender({ s: state('mine') })
  await act(async () => {
    vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS)
  })
  await settle()
  expect(result.current.error).toEqual({ kind: 'save', message: i18n.t('chat.draft.conflict') })

  act(() => result.current.retry())
  await settle()
  expect(result.current.error).toBeNull()
})
