import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { elapsedLabel } from '@/lib/elapsed'
import type { BackgroundTaskInfoResponse } from '@/types'
import { BackgroundTasksChip } from './background-tasks-chip'
import { ComposerStatusTab } from './composer-status-tab'

vi.mock('@/api', () => ({ api: { readBackgroundTaskOutput: vi.fn() } }))

beforeAll(() => {
  void i18n.changeLanguage('en')
})

function task(
  over: Partial<BackgroundTaskInfoResponse> & Pick<BackgroundTaskInfoResponse, 'id'>,
): BackgroundTaskInfoResponse {
  return {
    conversation_id: 'c1',
    runner: 'native',
    kind: 'command',
    command: 'npm run dev',
    description: null,
    state: 'running',
    exit_code: null,
    ended_reason: null,
    output_bytes: 0,
    output_truncated: false,
    started_at: Date.now(),
    ended_at: null,
    notified: false,
    ...over,
  }
}

describe('BackgroundTasksChip', () => {
  it('says how many are running, and lists and stops them from the popover', async () => {
    const stopped: string[] = []
    render(
      <BackgroundTasksChip
        conversationId="c1"
        tasks={[task({ id: 'b1', command: 'npm run dev' }), task({ id: 'b3', command: 'cargo watch' })]}
        onStop={(id) => stopped.push(id)}
      />,
    )
    const chip = screen.getByRole('button', { name: '2 background commands running' })
    expect(chip).toHaveTextContent('2 background commands')
    expect(screen.queryAllByText(/^\d+ s$/)).toHaveLength(0)
    await userEvent.click(chip)
    const dialog = await screen.findByRole('dialog', { name: '2 background commands running' })
    const rows = dialog.querySelectorAll('[data-slot="background-task-row"]')
    expect([...rows].map((r) => r.getAttribute('data-task-id'))).toEqual(['b1', 'b3'])

    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Stop' })[1])
    expect(stopped).toEqual(['b3'])
  })
})

describe('the output drawer', () => {
  it('opens on the output of a task, titled and described by what it is running', async () => {
    vi.mocked(api.readBackgroundTaskOutput).mockResolvedValue({
      content: 'compiled 12 modules',
      total_bytes: 19,
      task: task({ id: 'b1', description: 'Dev server', state: 'running' }),
    } as never)
    render(
      <BackgroundTasksChip
        conversationId="c1"
        tasks={[task({ id: 'b1', description: 'Dev server', command: 'npm run dev' })]}
        onStop={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '1 background command running' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Show output' }))

    const drawer = await screen.findByRole('dialog', { name: 'Dev server' })
    await waitFor(() => expect(within(drawer).getByText('compiled 12 modules')).toBeInTheDocument())
    expect(drawer).toHaveAccessibleDescription(/npm run dev/)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dev server' })).not.toBeInTheDocument())
  })
})

describe('ComposerStatusTab', () => {
  // The tab is drawn only when it has something in it; a running task is
  // reason enough on its own.
  it('opens for the background commands alone', () => {
    const { container, rerender } = render(<ComposerStatusTab />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ComposerStatusTab tasks={<span>tasks</span>} />)
    expect(screen.getByRole('group')).toHaveTextContent('tasks')
  })
})

describe('elapsedLabel', () => {
  // A running time drawn as `12:00` reads as noon; each range gets its unit.
  it('says how long in the largest unit that reads well', () => {
    expect(elapsedLabel(-5)).toEqual({ key: 'chat.background.elapsedSeconds', values: { count: 0 } })
    expect(elapsedLabel(45_000)).toEqual({ key: 'chat.background.elapsedSeconds', values: { count: 45 } })
    expect(elapsedLabel(12 * 60_000)).toEqual({ key: 'chat.background.elapsedMinutes', values: { count: 12 } })
    expect(elapsedLabel(65 * 60_000)).toEqual({
      key: 'chat.background.elapsedHours',
      values: { hours: 1, minutes: 5 },
    })
  })
})
