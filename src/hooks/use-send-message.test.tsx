import { act, renderHook } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(() => Promise.resolve()),
  acpSend: vi.fn(() => Promise.resolve()),
  uploadAttachment: vi.fn(() =>
    Promise.resolve({ type: 'image_url', image_url: { url: 'file:///attachments/design.png' } }),
  ),
  beginTurn: vi.fn(),
  abortTurn: vi.fn(),
  loadMessages: vi.fn(),
  setError: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: {
    chat: mocks.chat,
    acpSend: mocks.acpSend,
  },
}))

vi.mock('@/lib/upload', () => ({ uploadAttachment: mocks.uploadAttachment }))

vi.mock('@/stores/conversation-store', () => {
  const state = {
    conversations: [{ id: 'conversation-1', agent_kind: null }],
    sessions: {},
    beginTurn: mocks.beginTurn,
    abortTurn: mocks.abortTurn,
    loadMessages: mocks.loadMessages,
    setError: mocks.setError,
  }
  const useConversationStore = Object.assign((selector: (current: typeof state) => unknown) => selector(state), {
    setState: vi.fn(),
  })
  return { useConversationStore }
})

import { useSendMessage } from './use-send-message'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSendMessage', () => {
  it('keeps the original @ prompt as the text part when attachments and stickers serialize the message', async () => {
    const prompt = 'Inspect @"docs/my file.md"#L10-20 before replying'
    const contextRefs = [{ path: 'docs/my file.md', line_start: 10, line_end: 20 }]
    const { result } = renderHook(() =>
      useSendMessage('conversation-1', {
        streaming: false,
        selectedAssistantId: 'assistant-1',
        selectedModelId: 'model-1',
        selectedProviderId: 'provider-1',
        thinkingLevel: 'default',
        fastMode: false,
        mode: 'work',
      }),
    )

    await act(async () => {
      await result.current.sendMessage(
        prompt,
        false,
        [{ name: 'design.png', path: 'C:\\tmp\\design.png' }],
        undefined,
        undefined,
        { type: 'sticker', sticker_id: 'sticker-1' },
        contextRefs,
      )
    })

    expect(mocks.chat).toHaveBeenCalledTimes(1)
    const [, serialized, options] = mocks.chat.mock.calls[0]
    expect(JSON.parse(serialized as string)).toEqual([
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: 'file:///attachments/design.png' } },
      { type: 'sticker', sticker_id: 'sticker-1' },
    ])
    expect(options).toEqual(expect.objectContaining({ contextRefs }))
  })
})
