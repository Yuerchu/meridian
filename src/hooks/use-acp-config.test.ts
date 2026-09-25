import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/api'
import { useAcpConfig } from './use-acp-config'

vi.mock('@/api', () => ({ api: { acpSessionConfig: vi.fn(), acpSetSessionConfig: vi.fn() } }))
vi.mock('@/lib/transport', () => ({ listen: () => Promise.resolve(() => {}) }))

beforeEach(() => vi.clearAllMocks())

// The picker's refusal was `.catch(() => {})`: the model did not change and
// nothing said why.
test('a refused change keeps the agent’s reason', async () => {
  vi.mocked(api.acpSessionConfig).mockResolvedValue([])
  vi.mocked(api.acpSetSessionConfig).mockRejectedValueOnce('model not available on this plan')
  const { result } = renderHook(() => useAcpConfig('c1', true))
  await waitFor(() => expect(api.acpSessionConfig).toHaveBeenCalled())

  await act(async () => {
    await result.current.set('model', 'opus').catch(() => undefined)
  })

  expect(result.current.error).toBe('model not available on this plan')
  act(() => result.current.dismissError())
  expect(result.current.error).toBeNull()
})

test('a failed read of the knobs is an error, not an agent with none', async () => {
  vi.mocked(api.acpSessionConfig).mockRejectedValueOnce('response failed validation')
  const { result } = renderHook(() => useAcpConfig('c1', true))
  await waitFor(() => expect(result.current.error).toBe('response failed validation'))
})
