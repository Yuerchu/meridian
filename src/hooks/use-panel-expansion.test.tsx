import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'
import { useConversationStore } from '@/stores/conversation-store'
import { usePanelExpansion } from './use-panel-expansion'
import { TranscriptConversationProvider } from './use-transcript-conversation'

/**
 * Which conversation a panel's open/shut choice is filed under.
 *
 * It used to be the window's (`activeId`), which is the same answer as the
 * transcript's until two transcripts are on screen — the sub-agent sheet draws
 * a delegated run beside the conversation the window is on. The key is the
 * provider's call id, and those repeat across conversations, so the old
 * behaviour did not merely lose the choice: it could open or close an
 * unrelated tool in the transcript underneath.
 */

const OUTER = 'conv-outer'
const RUN = 'conv-run'

function inTranscript(conversationId: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <TranscriptConversationProvider value={conversationId}>{children}</TranscriptConversationProvider>
  }
}

const panelsOf = (id: string) => useConversationStore.getState().sessions[id]?.expandedPanels

describe('usePanelExpansion', () => {
  beforeEach(() => {
    useConversationStore.setState({ sessions: {}, activeId: OUTER })
    useConversationStore.getState().ensureSession(OUTER)
    useConversationStore.getState().ensureSession(RUN)
  })

  it('files the choice under the transcript being drawn, not the window', () => {
    const { result } = renderHook(() => usePanelExpansion('0', false, false), { wrapper: inTranscript(RUN) })

    act(() => result.current.onExpandedChange(true))

    expect(panelsOf(RUN)?.['0']).toBe(true)
    // The call id repeats across conversations; the outer one must be untouched.
    expect(panelsOf(OUTER)?.['0']).toBeUndefined()
  })

  it('reads back only its own transcript’s choice', () => {
    useConversationStore.getState().setPanelExpanded(OUTER, '0', true)

    const { result } = renderHook(() => usePanelExpansion('0', false, false), { wrapper: inTranscript(RUN) })

    expect(result.current.isExpanded).toBe(false)
  })

  it('falls back to the active conversation outside a transcript', () => {
    const { result } = renderHook(() => usePanelExpansion('0', false, false))

    act(() => result.current.onExpandedChange(true))

    expect(panelsOf(OUTER)?.['0']).toBe(true)
  })
})
