import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import { elapsedLabel } from '@/lib/elapsed'
import type { BackgroundTaskInfoResponse } from '@/types'
import { BackgroundTasksChip } from './background-tasks-chip'
import { ComposerStatusTab } from './composer-status-tab'

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
