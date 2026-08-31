import { conversationIdOf, dropDestination } from './sidebar-dnd'

/**
 * The RAC wiring around these is declarative config jsdom cannot drag
 * anything across; the decisions — which rows carry a conversation, which
 * rows are destinations — live here where a test can hold them.
 */
describe('sidebar drag and drop', () => {
  it('reads a conversation off its row key, under either prefix', () => {
    expect(conversationIdOf('d-conv-abc-123')).toBe('abc-123')
    expect(conversationIdOf('m-conv-abc-123')).toBe('abc-123')
  })

  it('gives no payload to rows that are not conversations', () => {
    expect(conversationIdOf('d-project-p1')).toBeNull()
    expect(conversationIdOf('d-all-projects')).toBeNull()
    expect(conversationIdOf('d-new')).toBeNull()
  })

  it('files onto a project row', () => {
    expect(dropDestination('d-project-p1')).toEqual({ projectId: 'p1' })
    expect(dropDestination('m-project-p1')).toEqual({ projectId: 'p1' })
  })

  /** The loose group unmounts when everything is filed, so this row being an
   *  unfile target is what keeps unfiling reachable by drag at all. */
  it('unfiles onto the all-projects row', () => {
    expect(dropDestination('d-all-projects')).toEqual({ projectId: null })
  })

  it('refuses every other row', () => {
    expect(dropDestination('d-conv-abc')).toBeNull()
    expect(dropDestination('d-new')).toBeNull()
    // A conversation whose uuid could read like a project's must not: the
    // prefix grammar anchors at the start, not anywhere in the key.
    expect(dropDestination('d-conv-project-x')).toBeNull()
  })
})
