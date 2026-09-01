import { renderHook, waitFor, act } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/api'
import type { QueueUpdatedEvent } from '@/lib/app-event'
import type { QueuedPromptInfoResponse } from '@/types'
import { usePromptQueue } from './use-prompt-queue'

vi.mock('@/api', () => ({
  api: { queueList: vi.fn() },
}))

/** Captured so a `queue-updated` can be delivered by hand. */
let notify: ((payload: QueueUpdatedEvent) => void) | null = null
vi.mock('@/lib/transport', () => ({
  listen: (_event: string, handler: (e: { payload: QueueUpdatedEvent }) => void) => {
    notify = (payload) => handler({ payload })
    return Promise.resolve(() => {
      notify = null
    })
  },
}))

const CONV = 'conv-1'

function row(id: string, over: Partial<QueuedPromptInfoResponse> = {}): QueuedPromptInfoResponse {
  return {
    id,
    conversation_id: CONV,
    content: id,
    delivery: 'follow_up',
    position: 0,
    created_at: 0,
    dispatched_at: null,
    dispatched_turn_id: null,
    settled_at: null,
    settled_message_id: null,
    held_at: null,
    reported_at: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  notify = null
})

/**
 * The row whose message is already in the transcript.
 *
 * `list` keeps returning it — the table is a ledger and nothing deletes a row —
 * so this side is the only thing that can stop drawing it. Left in, every
 * message ever sent through the queue stacks up above the composer looking
 * unsent, and none of them can be cleared: `remove` refuses anything already
 * delivered, so the button reports that the message has gone out while the row
 * that prompted it stays put.
 */
test('drops a row once its message is in the transcript', async () => {
  vi.mocked(api.queueList).mockResolvedValue([
    row('sent', { dispatched_at: 1, settled_at: 1, settled_message_id: 'm1' }),
    row('waiting'),
  ])

  const { result } = renderHook(() => usePromptQueue(CONV, true))

  await waitFor(() => expect(result.current.items).toHaveLength(1))
  expect(result.current.items[0]!.id).toBe('waiting')
})

/**
 * And the row that is settled but has no transcript row yet, which is a
 * different thing entirely. A steered message is settled when it is handed to
 * the running turn; the row it will occupy is owed to the next round boundary,
 * which can be a whole tool call later. For that gap this is the only place the
 * message exists, so filtering on `settled_at` would blink it out of view.
 */
test('keeps a steered message visible until its row is written', async () => {
  vi.mocked(api.queueList).mockResolvedValue([
    row('steered', { dispatched_at: 1, settled_at: 1, settled_message_id: null }),
  ])

  const { result } = renderHook(() => usePromptQueue(CONV, true))

  await waitFor(() => expect(result.current.items).toHaveLength(1))
  expect(result.current.items[0]!.id).toBe('steered')
})

/** The filter has to hold on every path that fills the list, and this is the
 *  one that runs for the rest of the session — the queue moves without anybody
 *  touching this window, and `queue-updated` is how it says so. */
test('still filters after the backend announces a change', async () => {
  vi.mocked(api.queueList).mockResolvedValue([row('waiting')])
  const { result } = renderHook(() => usePromptQueue(CONV, true))
  await waitFor(() => expect(result.current.items).toHaveLength(1))

  vi.mocked(api.queueList).mockResolvedValue([
    row('waiting', { dispatched_at: 2, settled_at: 2, settled_message_id: 'm2' }),
  ])
  await act(async () => {
    notify?.({ conversation_id: CONV, delivered: false })
  })

  await waitFor(() => expect(result.current.items).toHaveLength(0))
})
