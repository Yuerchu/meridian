import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const scroller = vi.hoisted(() => ({
  currentAnchorId: 'turn-2',
  scrollToMessage: vi.fn(() => true),
}))
const markArrival = vi.hoisted(() => vi.fn())

vi.mock('@/components/ui/message-scroller', () => ({
  useMessageScrollerVisibility: () => ({ currentAnchorId: scroller.currentAnchorId }),
  useMessageScroller: () => ({ scrollToMessage: scroller.scrollToMessage }),
}))
vi.mock('@/lib/arrival-flash', () => ({ markArrival }))

import i18n from '@/i18n'
import type { Turn } from '@/lib/turns'
import { TurnOutline } from './turn-outline'

function makeTurn(index: number, content: string | null): Turn {
  return {
    id: `turn-${index}`,
    userMessage:
      content === null
        ? null
        : ({
            id: `msg-${index}`,
            conversation_id: 'c1',
            role: 'user',
            content,
            created_at: index,
            turn_id: `turn-${index}`,
          } as Turn['userMessage']),
    assistantMessages: [],
    result: null,
    status: 'complete',
    durationMs: null,
    summary: { toolCount: 0, thinkingCount: 0, textCount: 0 },
    tokens: { input: null, output: null },
    usage: null,
    lastMessageId: `msg-${index}`,
    firstSortOrder: index,
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('TurnOutline', () => {
  it('stays hidden with fewer than four user turns', () => {
    const { container } = render(<TurnOutline turns={[makeTurn(1, 'One'), makeTurn(2, 'Two'), makeTurn(3, 'Three')]} />)
    expect(container.querySelector('[data-slot="turn-outline"]')).toBeNull()
  })

  it('highlights the active turn and jumps via scrollToMessage on press', async () => {
    const user = userEvent.setup()
    scroller.currentAnchorId = 'turn-2'
    scroller.scrollToMessage.mockClear()
    markArrival.mockClear()

    const { container } = render(
      <TurnOutline
        turns={[
          makeTurn(1, 'First question'),
          makeTurn(2, 'Second question'),
          makeTurn(3, 'Third question'),
          makeTurn(4, 'Fourth question'),
        ]}
      />,
    )

    const bars = container.querySelectorAll('[data-slot="turn-outline-bar"]')
    expect(bars).toHaveLength(4)
    expect(bars[1]).toHaveAttribute('data-active')

    const secondItem = screen.getByRole('button', { name: 'Second question' })
    expect(secondItem).toHaveAttribute('aria-current', 'location')

    await user.click(screen.getByRole('button', { name: 'Fourth question' }))
    expect(scroller.scrollToMessage).toHaveBeenCalledWith('turn-4', { align: 'start' })
    expect(markArrival).toHaveBeenCalledWith('turn-4')
  })
})
