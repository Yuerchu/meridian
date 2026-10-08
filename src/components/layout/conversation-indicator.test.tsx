import { render } from '@testing-library/react'

import i18n from '@/i18n'
import { useConversationStore } from '@/stores/conversation-store'
import { ConversationIndicator } from './conversation-indicator'

beforeAll(() => {
  void i18n.changeLanguage('en')
})

beforeEach(() => {
  useConversationStore.setState({ sessions: {}, attention: {}, attentionOrder: [], backgroundRunning: {} })
})

const slot = (container: HTMLElement) =>
  container.querySelector('[data-slot="conversation-indicator"] > [aria-hidden]')?.getAttribute('data-slot') ?? null

describe('ConversationIndicator — background commands', () => {
  // The conversations this matters for are mostly ones nobody has opened since
  // the command started, which have no session at all.
  it('marks a conversation with a command running, session or not', () => {
    useConversationStore.getState().setBackgroundRunning([{ conversation_id: 'c1', running: 2 }])
    const { container, getByText } = render(<ConversationIndicator conversationId="c1" activeId="other" />)
    expect(slot(container)).toBe('conversation-indicator-ring')
    expect(getByText('2 background commands running')).toBeInTheDocument()
  })

  it('marks a single command too', () => {
    useConversationStore.getState().setBackgroundRunning([{ conversation_id: 'c1', running: 1 }])
    const { container, getByText } = render(<ConversationIndicator conversationId="c1" activeId="other" />)
    expect(slot(container)).toBe('conversation-indicator-ring')
    expect(getByText('1 background command running')).toBeInTheDocument()
  })

  it('gives way to a turn running there', () => {
    const store = useConversationStore.getState()
    store.setBackgroundRunning([{ conversation_id: 'c1', running: 1 }])
    store.handleMessageStart('c1', 'm1', 't1', 'user')
    const { container } = render(<ConversationIndicator conversationId="c1" activeId="other" />)
    expect(slot(container)).toBe('conversation-indicator-dot')
  })

  // The conversation being read has the chip in its composer already.
  it('says nothing about the conversation being read', () => {
    useConversationStore.getState().setBackgroundRunning([{ conversation_id: 'c1', running: 1 }])
    const { container } = render(<ConversationIndicator conversationId="c1" activeId="c1" />)
    expect(container).toBeEmptyDOMElement()
  })

  // Replaced whole, so a conversation whose last command ended loses its mark
  // rather than keeping the count it had.
  it('goes once the last one ends', () => {
    const store = useConversationStore.getState()
    store.setBackgroundRunning([{ conversation_id: 'c1', running: 1 }])
    store.setBackgroundRunning([])
    const { container } = render(<ConversationIndicator conversationId="c1" activeId="other" />)
    expect(container).toBeEmptyDOMElement()
  })
})
