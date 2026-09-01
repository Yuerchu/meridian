import { acceptsConversationDrop, CONVERSATION_DRAG_TYPE, conversationIdOf } from './sidebar-dnd'

/**
 * The RAC wiring around these is declarative config jsdom cannot drag
 * anything across; the decisions — which rows carry a conversation, which
 * drags a group header may take — live here where a test can hold them.
 */
describe('sidebar drag and drop', () => {
  it('reads a conversation off its row key, under either prefix', () => {
    expect(conversationIdOf('d-conv-abc-123')).toBe('abc-123')
    expect(conversationIdOf('m-conv-abc-123')).toBe('abc-123')
  })

  it('gives no payload to rows that are not conversations', () => {
    expect(conversationIdOf('d-new')).toBeNull()
    expect(conversationIdOf('d-search')).toBeNull()
    expect(conversationIdOf('d-new-project')).toBeNull()
  })

  it('lets a group header take only conversation drags', () => {
    expect(acceptsConversationDrop(new Set([CONVERSATION_DRAG_TYPE]))).toBe(true)
    // A text drag from anywhere — the composer, another window — is not an
    // offer to refile a conversation.
    expect(acceptsConversationDrop(new Set(['text/plain']))).toBe(false)
    expect(acceptsConversationDrop(new Set())).toBe(false)
  })
})
