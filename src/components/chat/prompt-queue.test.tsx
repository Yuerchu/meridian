import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptInput } from '@heroui-pro/react/prompt-input'

import i18n from '@/i18n'
import type { QueuedPrompt } from '@/types'
import { PromptQueue } from './prompt-queue'

function withPromptInput(queue: React.ReactNode) {
  return (
    <PromptInput value="" onValueChange={() => {}} onSubmit={() => {}}>
      {queue}
    </PromptInput>
  )
}

function queued(id: string, position: number, overrides: Partial<QueuedPrompt> = {}): QueuedPrompt {
  return {
    id,
    conversation_id: 'conversation-1',
    content: `Prompt ${id}`,
    delivery: 'follow_up',
    position,
    created_at: position,
    dispatched_at: null,
    dispatched_turn_id: null,
    settled_at: null,
    settled_message_id: null,
    held_at: null,
    reported_at: null,
    ...overrides,
  }
}

describe('PromptQueue keyboard reordering', () => {
  beforeEach(() => i18n.changeLanguage('en'))

  it('moves a queued row with a named keyboard-operable action', async () => {
    const items = [queued('a', 0), queued('b', 1), queued('c', 2)]
    const onReorder = vi.fn()
    render(
      withPromptInput(
        <PromptQueue
          items={items}
          held={false}
          onRemove={vi.fn()}
          onReorder={onReorder}
          onSetDelivery={vi.fn()}
          onRelease={vi.fn()}
        />,
      ),
    )

    const moveDown = screen.getAllByRole('button', { name: 'Move down' })[0]
    moveDown.focus()
    await userEvent.keyboard('{Enter}')

    expect(onReorder).toHaveBeenCalledWith([items[1], items[0], items[2]])
  })

  it('does not offer movement across an in-doubt barrier', () => {
    render(
      withPromptInput(
        <PromptQueue
          items={[queued('a', 0), queued('barrier', 1, { dispatched_at: 1 }), queued('c', 2)]}
          held={false}
          onRemove={vi.fn()}
          onReorder={vi.fn()}
          onSetDelivery={vi.fn()}
          onRelease={vi.fn()}
        />,
      ),
    )

    expect(screen.getAllByRole('button', { name: 'Move down' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Move up' }).at(-1)).toBeDisabled()
  })
})
