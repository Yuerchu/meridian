import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { Turn } from '@/lib/turns'
import { ChatTranscript } from './chat-transcript'

vi.mock('@/hooks/use-android-insets', () => ({ useImeBottom: () => 0 }))
vi.mock('motion/react', () => ({
  LazyMotion: ({ children }: { children: React.ReactNode }) => children,
  domAnimation: {},
}))
vi.mock('motion/react-m', () => ({ create: (Component: React.ComponentType) => Component }))
vi.mock('./turn-outline', () => ({ TurnOutline: () => null }))
vi.mock('./turn-item', () => ({
  TurnItem: ({ turn }: { turn: Turn }) => <div data-testid="turn-rows">{turn.id}</div>,
}))
vi.mock('@/components/ui/message-scroller', () => ({
  MessageScrollerProvider: ({ children }: { children: React.ReactNode }) => children,
  MessageScroller: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerViewport: ({ children }: { children: React.ReactNode }) => (
    <div data-slot="message-scroller-viewport">{children}</div>
  ),
  MessageScrollerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerItem: ({ children, messageId }: { children: React.ReactNode; messageId?: string }) => (
    <div data-message-id={messageId}>{children}</div>
  ),
  MessageScrollerButton: () => null,
  useMessageScroller: () => ({ isFollowing: () => false, scrollToEnd: vi.fn(), scrollToMessage: vi.fn() }),
}))

function turn(id: number): Turn {
  return {
    id: `turn-${id}`,
    userMessage: null,
    assistantMessages: [],
    result: null,
    status: 'complete',
    durationMs: null,
    summary: { toolCount: 0, thinkingCount: 0, textCount: 0 },
    tokens: { input: null, output: null },
    usage: null,
    lastMessageId: `message-${id}`,
    firstSortOrder: id,
  }
}

/** A stand-in for the observer: remembers what it was asked to watch, and
 *  lets a test say which of those are near. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  targets = new Set<Element>()
  constructor(public callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) {
    this.targets.add(el)
  }
  disconnect() {
    this.targets.clear()
  }
  unobserve() {}
  takeRecords() {
    return []
  }
  report(el: Element, isIntersecting: boolean) {
    this.callback([{ target: el, isIntersecting } as IntersectionObserverEntry], this as never)
  }
}

/// `content-visibility: auto` by hand, because the real thing crashes desktop
/// WebView2 under a long transcript. A turn far from the viewport is a box of
/// its last known height; the last few are drawn from the first render, since
/// that is where the transcript opens and the observer has not spoken yet.
describe('lazy turns', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('draws only the tail until the observer says otherwise', () => {
    const turns = Array.from({ length: 30 }, (_, index) => turn(index))
    render(<ChatTranscript turns={turns} conversationId="c" streaming={false} />)

    // Every turn keeps its scroller row — anchoring and "load earlier" address
    // rows — but only the last six have their contents.
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(30)
    expect(screen.getAllByTestId('turn-rows')).toHaveLength(6)
    expect(screen.getByText('turn-29')).toBeInTheDocument()
    expect(screen.queryByText('turn-0')).toBeNull()
    // The box that stands in for a far turn has a height, so the scroll range
    // is about right before anything has been measured.
    const box = document.querySelector('[data-message-id="turn-0"] [data-slot="lazy-turn"] > div')!
    expect(box).toHaveAttribute('aria-hidden')
    expect((box as HTMLElement).style.height).not.toBe('')
  })

  /// Once and for good. Boxing a turn again after it had scrolled away moved
  /// the transcript above the reader, which the browser's scroll anchoring
  /// answers by moving `scrollTop` — an upward move the scroller reads as the
  /// reader leaving the live edge. The stream lost its following mid-answer.
  it('draws a turn once it comes near, and keeps it drawn after it has gone', () => {
    const turns = Array.from({ length: 30 }, (_, index) => turn(index))
    render(<ChatTranscript turns={turns} conversationId="c" streaming={false} />)

    const lazy = document.querySelector('[data-message-id="turn-0"] [data-slot="lazy-turn"]')!
    const observer = FakeIntersectionObserver.instances.find((o) => o.targets.has(lazy))!
    expect(observer).toBeDefined()

    act(() => observer.report(lazy, true))
    expect(screen.getByText('turn-0')).toBeInTheDocument()
    // The observer has done its job and is let go.
    expect(observer.targets.has(lazy)).toBe(false)

    act(() => observer.report(lazy, false))
    expect(screen.getByText('turn-0')).toBeInTheDocument()
  })

  it('draws everything where there is no observer to ask', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const turns = Array.from({ length: 30 }, (_, index) => turn(index))
    render(<ChatTranscript turns={turns} conversationId="c" streaming={false} />)
    expect(screen.getAllByTestId('turn-rows')).toHaveLength(30)
  })
})
