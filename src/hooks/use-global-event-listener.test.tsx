import { act, renderHook } from '@testing-library/react'

import type { CommandTurnOutcome, UserCommandEvent } from '@/types'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>()
  return {
    listeners,
    unlisten: vi.fn(),
    store: {
      beginShellCommand: vi.fn(),
      finishShellCommand: vi.fn(),
      loadMessages: vi.fn(() => Promise.resolve()),
      loadAllPending: vi.fn(),
    },
  }
})

vi.mock('@/lib/transport', () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(name, handler)
    return Promise.resolve(mocks.unlisten)
  }),
}))

vi.mock('@/stores/conversation-store', () => ({
  useConversationStore: { getState: () => mocks.store },
}))

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(() => Promise.resolve(false)),
  requestPermission: vi.fn(() => Promise.resolve('denied')),
  sendNotification: vi.fn(),
}))

import { useGlobalEventListener } from './use-global-event-listener'

const result: CommandTurnOutcome = {
  conversation_id: 'conversation-1',
  turn_id: 'turn-1',
  message_id: 'message-1',
  status: 'completed',
  stdout: 'done',
  stderr: '',
  exit_code: 0,
  timed_out: false,
  truncated: false,
  sandbox: 'windows_restricted_token',
  duration_ms: 5,
  cwd: 'C:/repo',
  host: 'desktop',
  error: null,
  can_retry_without_sandbox: false,
  retry_without_sandbox: false,
}

describe('global user-command events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.clear()
  })

  it('tracks start and finish outside the mounted ChatView and reloads the transcript', () => {
    renderHook(() => useGlobalEventListener())
    const listener = mocks.listeners.get('user-command')
    expect(listener).toBeDefined()

    const start: UserCommandEvent = {
      type: 'start',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      message_id: 'message-1',
      cwd: 'C:/repo',
      host: 'desktop',
      retry_without_sandbox: false,
    }
    act(() => listener?.({ payload: start }))
    expect(mocks.store.beginShellCommand).toHaveBeenCalledWith('conversation-1', 'turn-1')
    expect(mocks.store.loadMessages).toHaveBeenCalledWith('conversation-1')

    act(() => listener?.({ payload: { type: 'finish', result } satisfies UserCommandEvent }))
    expect(mocks.store.finishShellCommand).toHaveBeenCalledWith(result)
    expect(mocks.store.loadMessages).toHaveBeenLastCalledWith('conversation-1')
    expect(mocks.store.loadMessages).toHaveBeenCalledTimes(2)
  })
})
