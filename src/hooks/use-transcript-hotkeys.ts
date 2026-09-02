import { api } from '@/api'
import { buildAssistantGroups } from '@/lib/message-groups'
import { blocksOf, type Turn } from '@/lib/turns'
import { useConversationStore } from '@/stores/conversation-store'
import { useHotkey } from './use-hotkey'

/**
 * The transcript's keyboard shortcuts, for the conversation being read.
 *
 * Four chords, all `mod+shift+letter`. Letters rather than punctuation because
 * `matchesHotkey` compares `event.key`, and with Shift held a `.` arrives as
 * `>` on a US layout and as something else on every other one. `mod+shift+`
 * rather than a bare key because the composer nearly always has focus, and
 * the two that answer a question run *inside* a text field on purpose — a
 * chord has no editing meaning there, and a shortcut that only works after
 * clicking somewhere else is one nobody discovers.
 */
export const APPROVE_HOTKEY = 'mod+shift+y'
export const DENY_HOTKEY = 'mod+shift+n'
export const TOGGLE_PANELS_HOTKEY = 'mod+shift+o'
export const TOGGLE_THINKING_HOTKEY = 'mod+shift+t'

/**
 * The one question a shortcut may answer.
 *
 * Scanned from the tail of the transcript, stopping at the first turn that has
 * an answer in it — a question the user typed *after* a call was asked about
 * ends that call's claim on the keyboard, and a turn with nothing in it yet (a
 * queued prompt) is stepped over rather than stopped at. Within that turn, the
 * last unanswered call wins, which with calls dispatched one at a time is also
 * the only one. A delegated run's question counts through its `nested_approval`,
 * the way its key does.
 *
 * Never read off the attention queue. That holds questions from every
 * conversation, and a shortcut pressed while reading one must not answer a
 * question asked in another.
 */
export function targetApproval(turns: Turn[]): { approvalId: string } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.assistantMessages.length === 0) continue
    for (let m = turn.assistantMessages.length - 1; m >= 0; m--) {
      const blocks = blocksOf(turn.assistantMessages[m])
      for (let b = blocks.length - 1; b >= 0; b--) {
        const block = blocks[b]
        if (block.type !== 'tool_call') continue
        const call = block.data
        if (call.nested_approval) return { approvalId: call.nested_approval.approval_id }
        if (call.status === 'pending' && call.approval_id) return { approvalId: call.approval_id }
      }
    }
    return null
  }
  return null
}

/** The panel keys of the last bubble that has a keyboard, for the toggles. */
export function lastKeyboard(turns: Turn[]): { toolKeys: string[]; thinkingKey: string | null } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const groups = buildAssistantGroups(turns[i])
    for (let g = groups.length - 1; g >= 0; g--) {
      const bubbles = groups[g].bubbles
      for (let b = bubbles.length - 1; b >= 0; b--) {
        const bubble = bubbles[b]
        if (!('tools' in bubble)) continue
        if (bubble.tools.length === 0 && bubble.thinking.length === 0) continue
        return {
          // The same keys the panels register under — see `usePanelExpansion`
          // callers: a question's key carries a suffix, everything else is its
          // call id.
          toolKeys: bubble.tools.map((t) =>
            t.tool_name === 'ask_user' || t.tool_name === 'AskUserQuestion' ? `${t.call_id}:ask` : t.call_id,
          ),
          thinkingKey: bubble.thinking.length > 0 ? `${bubble.key}:thinking` : null,
        }
      }
    }
  }
  return null
}

/** Whether the transcript is behind something — settings, a review — and the
 *  shortcuts should stay out of the way. The shell marks it `inert`. */
function transcriptIsInert(): boolean {
  const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
  return viewport?.closest('[inert]') != null
}

export function useTranscriptHotkeys(conversationId: string, turns: Turn[]): void {
  useHotkey(
    APPROVE_HOTKEY,
    () => {
      if (transcriptIsInert()) return
      const target = targetApproval(turns)
      if (!target) return
      const { retireAnsweredApproval, markApprovalOrphaned } = useConversationStore.getState()
      api.approveToolCall(target.approvalId).then(
        () => retireAnsweredApproval(target.approvalId),
        () => markApprovalOrphaned(target.approvalId),
      )
    },
    { ignoreInInput: false },
  )

  useHotkey(
    DENY_HOTKEY,
    () => {
      if (transcriptIsInert()) return
      const target = targetApproval(turns)
      if (target) useConversationStore.getState().requestDeny(target.approvalId)
    },
    { ignoreInInput: false },
  )

  useHotkey(TOGGLE_PANELS_HOTKEY, () => {
    if (transcriptIsInert()) return
    const keyboard = lastKeyboard(turns)
    if (!keyboard || keyboard.toolKeys.length === 0) return
    // Decided off the screen rather than the store: a panel open because its
    // tool is running is open whether or not anyone chose it, and the first
    // press should close what is open.
    const turnsOnScreen = document.querySelectorAll('[data-slot="turn"]')
    const last = turnsOnScreen[turnsOnScreen.length - 1]
    const anyOpen = last?.querySelector('[data-slot="chat-tool-trigger"][aria-expanded="true"]') != null
    const { setPanelExpanded } = useConversationStore.getState()
    for (const key of keyboard.toolKeys) setPanelExpanded(conversationId, key, !anyOpen)
  })

  useHotkey(TOGGLE_THINKING_HOTKEY, () => {
    if (transcriptIsInert()) return
    const keyboard = lastKeyboard(turns)
    if (!keyboard?.thinkingKey) return
    const state = useConversationStore.getState()
    const current = state.sessions[conversationId]?.expandedPanels[keyboard.thinkingKey] ?? false
    state.setPanelExpanded(conversationId, keyboard.thinkingKey, !current)
  })
}
