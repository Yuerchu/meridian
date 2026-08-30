import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import type { Turn } from '@/lib/turns'
import { ChatTranscript } from './chat-transcript'

const scroller = vi.hoisted(() => ({ scrollToMessage: vi.fn() }))

vi.mock('@/hooks/use-android-insets', () => ({ useImeBottom: () => 0 }))
vi.mock('motion/react', () => ({
  LazyMotion: ({ children }: { children: React.ReactNode }) => children,
  domAnimation: {},
}))
vi.mock('motion/react-m', () => ({ create: (Component: React.ComponentType) => Component }))
vi.mock('./turn-outline', () => ({
  TurnOutline: ({ turns }: { turns: Turn[] }) => <div data-testid="turn-outline">{turns.map((turn) => turn.id)}</div>,
}))
vi.mock('./turn-item', () => ({
  TurnItem: ({ turn }: { turn: Turn }) => <div>{turn.id}</div>,
}))
vi.mock('@/components/ui/message-scroller', () => ({
  MessageScrollerProvider: ({ children }: { children: React.ReactNode }) => children,
  MessageScroller: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerViewport: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerItem: ({
    children,
    messageId,
    ...props
  }: { children: React.ReactNode; messageId?: string } & React.ComponentProps<'div'>) => (
    <div data-message-id={messageId} {...props}>
      {children}
    </div>
  ),
  MessageScrollerButton: () => null,
  useMessageScroller: () => ({
    isFollowing: () => false,
    scrollToEnd: vi.fn(),
    scrollToMessage: scroller.scrollToMessage,
  }),
}))

function turn(id: number): Turn {
  return {
    id: `turn-${id}`,
    userMessage: null,
    assistantMessages: [],
    steps: [],
    pinned: [],
    result: null,
    status: 'complete',
    durationMs: null,
    summary: { toolCount: 0, thinkingCount: 0, textCount: 0, lastToolName: null },
    tokens: { input: null, output: null },
    usage: null,
    lastMessageId: `message-${id}`,
    firstSortOrder: id,
  }
}

describe('ChatTranscript long-history window', () => {
  beforeEach(async () => {
    scroller.scrollToMessage.mockClear()
    await i18n.changeLanguage('en')
  })

  it('renders a bounded tail and loads earlier chunks without content-visibility', async () => {
    const turns = Array.from({ length: 65 }, (_, index) => turn(index))
    const { container } = render(<ChatTranscript turns={turns} conversationId="conversation-1" streaming={false} />)

    expect(screen.queryByText('turn-24')).toBeNull()
    expect(screen.getByText('turn-25')).toBeVisible()
    expect(screen.getByText('turn-64')).toBeVisible()
    expect(screen.getByTestId('turn-outline')).not.toHaveTextContent('turn-24')
    expect(screen.getByTestId('turn-outline')).toHaveTextContent('turn-25')
    expect(container.innerHTML).not.toContain('content-visibility')

    await userEvent.click(screen.getByRole('button', { name: 'Load earlier messages (25 remaining)' }))

    expect(await screen.findByText('turn-0')).toBeVisible()
    expect(screen.getByTestId('turn-outline')).toHaveTextContent('turn-0')
    await waitFor(() =>
      expect(scroller.scrollToMessage).toHaveBeenCalledWith('turn-25', { align: 'start', behavior: 'auto' }),
    )
    expect(container.querySelector('[data-message-id="turn-25"]')).toHaveFocus()
    expect(screen.queryByRole('button', { name: /Load earlier messages/ })).toBeNull()
  })

  it('keeps the oldest visible turn mounted when a live turn is appended', async () => {
    const turns = Array.from({ length: 65 }, (_, index) => turn(index))
    const { rerender } = render(<ChatTranscript turns={turns} conversationId="conversation-1" streaming={false} />)
    await screen.findByText('turn-25')

    rerender(<ChatTranscript turns={[...turns, turn(65)]} conversationId="conversation-1" streaming />)

    expect(screen.getByText('turn-25')).toBeVisible()
    expect(screen.getByText('turn-65')).toBeVisible()
  })
})
