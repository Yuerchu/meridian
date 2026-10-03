import { render } from '@testing-library/react'
import { useContext, useEffect } from 'react'

import { RevealHostContext } from '@/hooks/use-revealed-text'
import { answerAnchorId, type Turn } from '@/lib/turns'
import { ChatTranscript } from './chat-transcript'

/**
 * The end-of-turn scroll back to the answer waits for the paced reveal: a
 * stream that has ended while its last burst is still being drawn is not
 * finished yet, and settling then measures a half-drawn answer.
 */
const scroller = vi.hoisted(() => ({ scrollToMessage: vi.fn() }))
const reveal = vi.hoisted(() => ({ on: false }))

vi.mock('@/hooks/use-android-insets', () => ({ useImeBottom: () => 0 }))
vi.mock('motion/react', () => ({
  LazyMotion: ({ children }: { children: React.ReactNode }) => children,
  domAnimation: {},
}))
vi.mock('motion/react-m', () => ({ create: (Component: React.ComponentType) => Component }))
vi.mock('./turn-outline', () => ({ TurnOutline: () => null }))
vi.mock('./turn-item', () => ({
  // Stands in for a bubble that is still drawing: it reports as the real one does.
  TurnItem: function Bubble() {
    const { report } = useContext(RevealHostContext)
    const on = reveal.on
    useEffect(() => report('bubble', on), [report, on])
    return null
  },
}))
vi.mock('@/components/ui/message-scroller', () => ({
  MessageScrollerProvider: ({ children }: { children: React.ReactNode }) => children,
  MessageScroller: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerViewport: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerButton: () => null,
  useMessageScroller: () => ({
    isFollowing: () => true,
    scrollToEnd: vi.fn(),
    scrollToMessage: scroller.scrollToMessage,
  }),
}))

const turns: Turn[] = [
  {
    id: 'turn-1',
    userMessage: null,
    assistantMessages: [],
    result: null,
    status: 'complete',
    durationMs: null,
    summary: { toolCount: 0, thinkingCount: 0, textCount: 0 },
    tokens: { input: null, output: null },
    usage: null,
    lastMessageId: 'message-1',
    firstSortOrder: 1,
  },
]

it('settles on the answer only once its text has been drawn, not when the stream ends', () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  try {
    reveal.on = true
    const view = render(<ChatTranscript turns={turns} conversationId="c" streaming />)
    view.rerender(<ChatTranscript turns={turns} conversationId="c" streaming={false} />)
    expect(scroller.scrollToMessage).not.toHaveBeenCalled()

    reveal.on = false
    view.rerender(<ChatTranscript turns={turns} conversationId="c" streaming={false} />)
    expect(scroller.scrollToMessage).toHaveBeenCalledTimes(1)
    expect(scroller.scrollToMessage).toHaveBeenCalledWith(answerAnchorId('turn-1'), {
      align: 'start',
      onlyWhenAbove: true,
    })
  } finally {
    vi.unstubAllGlobals()
  }
})
