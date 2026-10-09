// What a card says about its agent: derived, never stored. The column a card
// is in is a person's choice (`board_tasks.stage`); this is the mark on the
// card, read from the same places the transcript reads — the attention queue
// for what is waiting on a person, the session for what is running, and the
// turns' durable status for how the last one ended.
import type { TFunction } from 'i18next'

import { latestStep } from '@/components/chat/latest-step'
import type { AttentionItem, ConversationSession } from '@/stores/conversation-store'
import type { BoardTaskInfoResponse } from '@/types'

export type AgentState =
  /** Not started, or started and nothing has run yet. */
  | { kind: 'idle' }
  | { kind: 'working'; step: string | null }
  /** A tool call waiting on Allow / Deny. */
  | { kind: 'approval'; item: AttentionItem; askedAt: number | null }
  /** A question with a form behind it: `ask_user`, an elicitation, a plan
   *  review. The model wanting something from the person is always this. */
  | { kind: 'question'; item: AttentionItem; askedAt: number | null }
  | { kind: 'failed'; reason: string | null; at: number | null }
  /** The last turn ended — normally, or because somebody stopped it. */
  | { kind: 'finished'; stopped: boolean; summary: string | null; at: number | null }

/** Whether the card is waiting on a person: the strip and the PageUp /
 *  PageDown walk go through exactly these. */
export function needsPerson(state: AgentState): boolean {
  return state.kind === 'approval' || state.kind === 'question' || state.kind === 'failed'
}

/** When the state started asking, for ordering the strip oldest first. A plan
 *  review rebuilt from a snapshot does not say, and sorts last. */
export function askedAtOf(state: AgentState): number {
  if (state.kind === 'approval' || state.kind === 'question') return state.askedAt ?? Number.POSITIVE_INFINITY
  if (state.kind === 'failed') return state.at ?? Number.POSITIVE_INFINITY
  return Number.POSITIVE_INFINITY
}

export function agentStateOf(
  t: TFunction,
  task: Pick<BoardTaskInfoResponse, 'conversation_id'>,
  session: Pick<ConversationSession, 'streaming' | 'messages' | 'turns'> | undefined,
  attention: readonly AttentionItem[],
): AgentState {
  if (task.conversation_id === null) return { kind: 'idle' }

  // What waits on a person outranks everything: a turn that asked is still
  // "running" by its status, and the card has to say it is asking.
  const waiting = [...attention].sort(
    (a, b) => (a.askedAt ?? Number.POSITIVE_INFINITY) - (b.askedAt ?? Number.POSITIVE_INFINITY),
  )[0]
  if (waiting) {
    return waiting.kind === 'approval'
      ? { kind: 'approval', item: waiting, askedAt: waiting.askedAt }
      : { kind: 'question', item: waiting, askedAt: waiting.askedAt }
  }

  if (!session) return { kind: 'idle' }
  const last = session.turns.length > 0 ? session.turns[session.turns.length - 1] : undefined
  if (session.streaming || last?.status === 'running' || last?.status === 'waiting_review') {
    return { kind: 'working', step: latestStep(t, session.messages, null) }
  }
  if (!last) return { kind: 'idle' }
  switch (last.status) {
    case 'failed':
    case 'interrupted':
      return { kind: 'failed', reason: last.error, at: last.ended_at }
    case 'cancelled':
      return { kind: 'finished', stopped: true, summary: null, at: last.ended_at }
    case 'done':
      return {
        kind: 'finished',
        stopped: false,
        summary: latestStep(t, session.messages, last.id),
        at: last.ended_at,
      }
  }
}
