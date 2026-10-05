import { act, renderHook, waitFor } from '@testing-library/react'

import i18n from '@/i18n'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { UserCommandEvent, UserCommandResultResponse } from '@/types'
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification'

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
      handlePlanReviewEvent: vi.fn(),
      handleToolApproval: vi.fn(),
      activeId: null,
      conversations: [{ id: 'conversation-1', title: 'Plan conversation' }],
      sessions: {},
    },
    notices: { load: vi.fn(() => Promise.resolve()), receive: vi.fn() },
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

vi.mock('@/stores/system-notice-store', () => ({
  useSystemNoticeStore: { getState: () => mocks.notices },
}))

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(() => Promise.resolve(false)),
  requestPermission: vi.fn(() => Promise.resolve('denied')),
  sendNotification: vi.fn(),
}))

import { useGlobalEventListener } from './use-global-event-listener'

const result: UserCommandResultResponse = {
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
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
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

  it('loads the notices of this machine on mount and hands each event to their store', () => {
    renderHook(() => useGlobalEventListener())
    expect(mocks.notices.load).toHaveBeenCalledTimes(1)
    const event = { type: 'dismiss', id: 'n-1' }
    act(() => mocks.listeners.get('system-notice')?.({ payload: event }))
    expect(mocks.notices.receive).toHaveBeenCalledWith(event)
  })

  it('parses chat-stream payloads before dispatching them to the store', () => {
    renderHook(() => useGlobalEventListener())
    const listener = mocks.listeners.get('chat-stream')
    expect(listener).toBeDefined()

    expect(() =>
      listener?.({
        payload: {
          type: 'tool_result',
          call_id: 'call-1',
          result: 'done',
          outcome: 'future',
          message_id: 'message-1',
          conversation_id: 'conversation-1',
        },
      }),
    ).toThrow('tool_result event.outcome must be one of')
  })

  it('calls a question a question in the OS notification, under either name', async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true)
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    renderHook(() => useGlobalEventListener())
    const listener = mocks.listeners.get('chat-stream')
    for (const [index, tool_name] of ['ask_user', 'AskUserQuestion', 'run_command'].entries()) {
      act(() =>
        listener?.({
          payload: {
            type: 'tool_approval_req',
            approval_id: `approval-${index}`,
            call_id: `call-${index}`,
            tool_name,
            arguments: '{}',
            message_id: 'message-1',
            conversation_id: 'conversation-1',
            delegation: null,
            retry: null,
            asked_at: 1_700_000_000_000,
          },
        }),
      )
    }
    await waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(3))
    expect(vi.mocked(sendNotification).mock.calls.map(([n]) => n.body)).toEqual([
      'Action required: Question',
      'Action required: Question',
      'Action required: run_command',
    ])
    focus.mockRestore()
  })

  it('notifies once when a settled plan continuation first needs attention', async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true)
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    renderHook(() => useGlobalEventListener())
    const listener = mocks.listeners.get('plan-review-updated')
    const queued = {
      review_id: 'review-1',
      conversation_id: 'conversation-1',
      document_id: 'document-1',
      revision_id: 'revision-1',
      turn_id: 'turn-1',
      status: 'approved',
      delivery_state: 'queued',
      lock_version: 1,
    } as const

    act(() => listener?.({ payload: queued }))
    expect(sendNotification).not.toHaveBeenCalled()

    const held = { ...queued, delivery_state: 'held', lock_version: 2 } as const
    act(() => listener?.({ payload: held }))
    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith({
        title: 'Plan conversation',
        body: i18n.t('chat.plan.continuationNeedsAttention'),
      }),
    )

    // Replayed equal-version events are accepted as idempotent projections,
    // but they must not repeat an OS notification the user already received.
    act(() => listener?.({ payload: held }))
    await Promise.resolve()
    expect(sendNotification).toHaveBeenCalledTimes(1)

    act(() => listener?.({ payload: { ...held, delivery_state: 'acknowledged', lock_version: 3 } }))
    expect(sendNotification).toHaveBeenCalledTimes(1)
    focus.mockRestore()
  })
})
