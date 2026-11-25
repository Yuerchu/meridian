import i18n from '@/i18n'
import { act, render, screen, waitFor } from '@testing-library/react'

import { useConversationStore } from '@/stores/conversation-store'
import type { MessageViewModel, UserCommandResultResponse } from '@/types'

const getUserCommandResult = vi.hoisted(() => vi.fn())

vi.mock('@/api', () => ({ api: { userCommands: { getResult: getUserCommandResult } } }))

import { ShellCommandBubble } from './shell-command-bubble'

const message = {
  id: 'message-1',
  conversation_id: 'conversation-1',
  role: 'user',
  content: '!pnpm test',
  source: 'shell',
  turn_id: 'turn-1',
} as MessageViewModel

const result: UserCommandResultResponse = {
  conversation_id: 'conversation-1',
  turn_id: 'turn-1',
  message_id: 'message-1',
  status: 'completed',
  stdout: '12 tests passed',
  stderr: '',
  exit_code: 0,
  timed_out: false,
  truncated: false,
  sandbox: 'windows_restricted_token',
  duration_ms: 42,
  cwd: 'C:/repo',
  host: 'desktop',
  error: null,
  can_retry_without_sandbox: false,
  retry_without_sandbox: false,
}

beforeEach(() => {
  getUserCommandResult.mockReset()
  useConversationStore.setState({ sessions: {} })
  useConversationStore.getState().ensureSession('conversation-1')
})

it('names the native loading indicator and removes it after the result arrives', async () => {
  let resolve!: (value: UserCommandResultResponse) => void
  getUserCommandResult.mockReturnValue(
    new Promise<UserCommandResultResponse>((done) => {
      resolve = done
    }),
  )
  render(<ShellCommandBubble message={message} />)
  expect(screen.getByRole('progressbar', { name: i18n.t('chat.shell.loading') })).toBeInTheDocument()
  await act(async () => resolve(result))
  expect(screen.queryByRole('progressbar', { hidden: true })).toBeNull()
})

it('rehydrates a structured command result without reading raw transcript context', async () => {
  getUserCommandResult.mockResolvedValue(result)
  render(<ShellCommandBubble message={message} />)

  expect(screen.getByText('pnpm test')).toBeInTheDocument()
  expect(await screen.findByText('12 tests passed')).toBeInTheDocument()
  expect(screen.getByText('C:/repo')).toBeInTheDocument()
  await waitFor(() =>
    expect(getUserCommandResult).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      message_id: 'message-1',
    }),
  )
})

it('waits for the matching finish event and then refreshes an in-flight card', async () => {
  getUserCommandResult.mockResolvedValue(result)
  act(() => useConversationStore.getState().beginShellCommand('conversation-1', 'turn-1'))

  render(<ShellCommandBubble message={message} />)
  expect(getUserCommandResult).not.toHaveBeenCalled()

  act(() => useConversationStore.getState().finishShellCommand(result))

  expect(await screen.findByText('12 tests passed')).toBeInTheDocument()
  expect(getUserCommandResult).toHaveBeenCalledTimes(1)
})

it('renders a completed command with a non-zero exit as a failure', async () => {
  getUserCommandResult.mockResolvedValue({ ...result, stdout: '', exit_code: 7 })
  render(<ShellCommandBubble message={message} />)

  await waitFor(() => expect(getUserCommandResult).toHaveBeenCalled())
  const outcome = document.querySelector('[data-command-outcome]')
  expect(outcome).toHaveAttribute('data-command-outcome', 'failure')
  expect(outcome?.querySelector('svg')).toHaveAttribute('data-tone', 'danger')
})
