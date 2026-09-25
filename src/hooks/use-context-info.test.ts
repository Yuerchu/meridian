import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/api'
import type { ContextInfoResponse } from '@/types'
import { useContextInfo } from './use-context-info'

vi.mock('@/api', () => ({
  api: {
    getContextInfo: vi.fn(),
  },
}))

const getContextInfo = vi.mocked(api.getContextInfo)

function info(over: Partial<ContextInfoResponse> = {}): ContextInfoResponse {
  return {
    estimated_tokens: 1200,
    context_limit: 64_000,
    compact_threshold: 50_000,
    auto_compact_enabled: true,
    circuit_breaker_state: 'closed',
    message_count: 3,
    model: 'm1',
    agent_kind: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/** No placeholder window before the first answer: this started from
 *  `context_limit ?? 128000`, a number nobody configured. */
test('starts from nothing rather than from an invented window', () => {
  getContextInfo.mockReturnValue(new Promise(() => {}))
  const { result } = renderHook(() =>
    useContextInfo('c1', { messageCount: 0, compactBoundary: null, compacting: false }),
  )
  expect(result.current).toMatchObject({ status: 'loading' })
})

test('carries the window the backend resolved', async () => {
  getContextInfo.mockResolvedValue(info())
  const { result } = renderHook(() =>
    useContextInfo('c1', { messageCount: 3, compactBoundary: null, compacting: false }),
  )
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current).toMatchObject({ status: 'ready', reading: { contextLimit: 64_000, messageCount: 3 } })
})

/** A failed read after a good one does not keep the good one: after a model
 *  switch that reading describes a window this conversation no longer uses. */
test('a failed read replaces the last reading with the reason', async () => {
  getContextInfo.mockResolvedValueOnce(info())
  const { result, rerender } = renderHook(
    ({ count }) => useContextInfo('c1', { messageCount: count, compactBoundary: null, compacting: false }),
    { initialProps: { count: 3 } },
  )
  await waitFor(() => expect(result.current.status).toBe('ready'))

  getContextInfo.mockRejectedValueOnce("No context window known for 'm2'.")
  rerender({ count: 4 })
  await waitFor(() => expect(result.current.status).toBe('unavailable'))
  expect(result.current).toMatchObject({ status: 'unavailable', reason: "No context window known for 'm2'." })
})

// The reading's failure used to be `.catch(() => {})`: the gauge kept its
// defaults and nothing said the numbers were not a reading at all.
test('keeps the reason a reading failed, and a retry that reads again', async () => {
  getContextInfo.mockRejectedValueOnce('no model configured')
  const { result } = renderHook(() =>
    useContextInfo('c1', { messageCount: 1, compactBoundary: null, compacting: false }),
  )
  await waitFor(() => expect(result.current).toMatchObject({ status: 'unavailable', reason: 'no model configured' }))

  getContextInfo.mockResolvedValueOnce(info({ estimated_tokens: 10 }))
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current).toMatchObject({ reading: { estimatedTokens: 10 } })
})
