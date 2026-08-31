import type { ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptInput } from '@heroui-pro/react/prompt-input'

import i18n from '@/i18n'
import { PromptQueue } from './prompt-queue'
import type { QueuedPrompt } from '@/types'
import type { TodoArgs } from './todo-list'

beforeAll(() => {
  void i18n.changeLanguage('en')
})

function item(over: Partial<QueuedPrompt> & Pick<QueuedPrompt, 'id' | 'content' | 'delivery'>): QueuedPrompt {
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
  it('nests an interjection under the current run with Pro’s ↳, and leaves a follow-up as a sibling', () => {
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
