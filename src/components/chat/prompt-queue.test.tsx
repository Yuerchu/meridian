import type { ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptInput } from '@/components/base'

import i18n from '@/i18n'
import { PromptQueue } from './prompt-queue'
import type { QueuedPromptInfoResponse } from '@/types'
import type { TodoArgs } from './todo-list'

beforeAll(() => {
  void i18n.changeLanguage('en')
})

function item(
  over: Partial<QueuedPromptInfoResponse> & Pick<QueuedPromptInfoResponse, 'id' | 'content' | 'delivery'>,
): QueuedPromptInfoResponse {
  return {
    conversation_id: 'c1',
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

const TODOS: TodoArgs = {
  title: 'Update llama.cpp',
  todos: [
    { content: 'Check install', active_form: 'Checking install', status: 'completed' },
    { content: 'Swap binary', active_form: 'Swapping binary', status: 'in_progress' },
  ],
}

const NOOP = {
  held: false,
  onRemove: () => {},
  onReorder: () => {},
  onSetDelivery: () => {},
  onRelease: () => {},
}

function mount(ui: ReactElement) {
  return render(<PromptInput>{ui}</PromptInput>)
}

function rowFor(text: string) {
  const content = screen.getByText(text)
  const row = content.closest('[data-slot="prompt-input-queue-item"]')
  if (!row) throw new Error(`no queue row for ${text}`)
  return row as HTMLElement
}

describe('PromptQueue', () => {
  // The envelope is read back, never shown: it carries local file paths. An
  // interjection is text, so a row with attachments offers no Steer.
  it('shows a queued message with attachments as its words, with the count and no Steer', () => {
    const parts = JSON.stringify([
      { type: 'text', text: 'compare these' },
      { type: 'image_url', image_url: { url: 'file:///data/files/c1/a.png' } },
      { type: 'file', file: { url: 'file:///data/files/c1/b.pdf', mime_type: 'application/pdf', name: 'report.pdf' } },
    ])
    const onlyFiles = JSON.stringify([
      { type: 'file', file: { url: 'file:///data/files/c1/c.pdf', mime_type: 'application/pdf', name: 'spec.pdf' } },
    ])
    mount(
      <PromptQueue
        {...NOOP}
        items={[
          item({ id: 'a', content: parts, delivery: 'follow_up' }),
          item({ id: 'b', content: onlyFiles, delivery: 'follow_up' }),
          item({ id: 'c', content: 'plain words', delivery: 'follow_up' }),
        ]}
      />,
    )

    expect(screen.queryByText(/file:\/\//)).toBeNull()
    const attached = rowFor('compare these')
    expect(within(attached).getByText(/Attachments: 2/)).toBeInTheDocument()
    expect(attached.querySelector('[data-slot="prompt-input-queue-item-steer"]')).toBeNull()
    // Nothing written: the names stand in for the text.
    expect(rowFor('spec.pdf').querySelector('[data-slot="prompt-input-queue-item-steer"]')).toBeNull()
    const plain = rowFor('plain words')
    expect(plain.querySelector('[data-slot="queue-attachments"]')).toBeNull()
    expect(plain.querySelector('[data-slot="prompt-input-queue-item-steer"]')).not.toBeNull()
  })

  it('nests an interjection under the current run with the ↳ mark, and leaves a follow-up as a sibling', () => {
    mount(
      <PromptQueue
        {...NOOP}
        currentTodos={TODOS}
        streaming
        items={[
          item({ id: 'a', content: 'do this later', delivery: 'follow_up' }),
          item({ id: 'b', content: 'interrupt me', delivery: 'interject' }),
        ]}
      />,
    )

    const current = screen.getByText('Update llama.cpp').closest('[data-slot="queue-current"]')
    expect(current).not.toBeNull()
    expect(current).toContainElement(screen.getByText('Swapping binary'))

    const follow = rowFor('do this later')
    expect(within(follow).getByText('do this later')).toBeInTheDocument()
    expect(follow.querySelector('[data-delivery="follow_up"]')).not.toBeNull()
    expect(follow.querySelector('[data-slot="prompt-input-queue-item-steer"]')).not.toBeNull()
    expect(follow.querySelector('[data-slot="prompt-input-queue-item-steer"]')).toHaveTextContent('↳')

    const interject = rowFor('interrupt me')
    expect(interject.querySelector('[data-delivery="interject"]')).not.toBeNull()
    expect(interject.querySelector('[data-slot="queue-steer-mark"]')).not.toBeNull()
    expect(interject.querySelector('[data-slot="prompt-input-queue-item-steer"]')).toBeNull()
    expect(within(interject).getByText('After it finishes')).toBeInTheDocument()
  })

  it('draws a generic current row when the turn is running with no checklist', () => {
    mount(<PromptQueue {...NOOP} streaming items={[item({ id: 'a', content: 'next', delivery: 'follow_up' })]} />)
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getByText('Working').closest('[data-slot="queue-current"]')).not.toBeNull()
  })

  it('steers a follow-up into an interjection', async () => {
    const onSetDelivery = vi.fn()
    mount(
      <PromptQueue
        {...NOOP}
        onSetDelivery={onSetDelivery}
        items={[item({ id: 'a', content: 'next', delivery: 'follow_up' })]}
      />,
    )
    await userEvent.click(screen.getByText('Interrupt'))
    expect(onSetDelivery).toHaveBeenCalledWith('a', 'interject')
  })
})

/** The drag handle needs a pointer; these are the same moves for a keyboard. */
describe('PromptQueue keyboard reordering', () => {
  it('moves a queued row with a named keyboard-operable action', async () => {
    const items = [
      item({ id: 'a', content: 'Prompt a', delivery: 'follow_up', position: 0 }),
      item({ id: 'b', content: 'Prompt b', delivery: 'follow_up', position: 1 }),
      item({ id: 'c', content: 'Prompt c', delivery: 'follow_up', position: 2 }),
    ]
    const onReorder = vi.fn()
    mount(<PromptQueue {...NOOP} onReorder={onReorder} items={items} />)

    const moveDown = screen.getAllByRole('button', { name: 'Move down' })[0]
    moveDown.focus()
    await userEvent.keyboard('{Enter}')

    expect(onReorder).toHaveBeenCalledWith([items[1], items[0], items[2]])
  })

  it('does not offer movement across an in-doubt barrier', () => {
    mount(
      <PromptQueue
        {...NOOP}
        items={[
          item({ id: 'a', content: 'Prompt a', delivery: 'follow_up', position: 0 }),
          item({ id: 'barrier', content: 'Prompt barrier', delivery: 'follow_up', position: 1, dispatched_at: 1 }),
          item({ id: 'c', content: 'Prompt c', delivery: 'follow_up', position: 2 }),
        ]}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'Move down' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Move up' }).at(-1)).toBeDisabled()
  })
})
