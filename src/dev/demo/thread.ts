import type { BranchPointInfoResponse, ConversationSnapshotResponse, MessageInfoResponse } from '@/types'
import type { DemoThread } from './conversations'
import type { DemoState } from './state'

/** The same walk `active_context` does: from the head up to the root. */
export function activePath(thread: DemoThread): MessageInfoResponse[] {
  const byId = new Map(thread.all.map((m) => [m.id, m]))
  const path: MessageInfoResponse[] = []
  let current = thread.head ? byId.get(thread.head) : undefined
  while (current) {
    path.push(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return path.reverse()
}

function siblingsOf(thread: DemoThread, row: MessageInfoResponse): MessageInfoResponse[] {
  return thread.all
    .filter((m) => m.parent_id === row.parent_id && m.role === row.role)
    .sort((a, b) => a.created_at - b.created_at)
}

export function branchPoints(thread: DemoThread, path: MessageInfoResponse[]): BranchPointInfoResponse[] {
  const points: BranchPointInfoResponse[] = []
  for (const row of path) {
    const siblings = siblingsOf(thread, row)
    if (siblings.length < 2) continue
    points.push({
      message_id: row.id,
      index: siblings.findIndex((s) => s.id === row.id),
      total: siblings.length,
      sibling_ids: siblings.map((s) => s.id),
    })
  }
  return points
}

/** Down from `id`, taking the newest child each step — "its most recent tip". */
export function newestTip(thread: DemoThread, id: string): string {
  let current = id
  for (;;) {
    const children = thread.all.filter((m) => m.parent_id === current).sort((a, b) => b.created_at - a.created_at)
    if (children.length === 0) return current
    current = children[0].id
  }
}

export function deleteSubtree(thread: DemoThread, id: string) {
  const doomed = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const m of thread.all) {
      if (m.parent_id && doomed.has(m.parent_id) && !doomed.has(m.id)) {
        doomed.add(m.id)
        grew = true
      }
    }
  }
  const target = thread.all.find((m) => m.id === id)
  thread.all = thread.all.filter((m) => !doomed.has(m.id))
  if (thread.head && doomed.has(thread.head)) {
    const parent = target?.parent_id ?? null
    thread.head = parent ? newestTip(thread, parent) : (thread.all[thread.all.length - 1]?.id ?? null)
  }
}

export function mintId(state: DemoState, prefix: string): string {
  state.serial += 1
  return `demo-${prefix}-${state.serial}-${Math.random().toString(36).slice(2, 8)}`
}

export function touchConversation(state: DemoState, conversationId: string, head: string | null) {
  const row = state.conversations.find((c) => c.id === conversationId)
  if (!row) return
  row.updated_at = Date.now()
  row.head_message_id = head
  row.message_count = state.threads[conversationId]?.all.length ?? 0
}

export function snapshot(state: DemoState, conversationId: string): ConversationSnapshotResponse {
  const conversation = state.conversations.find((c) => c.id === conversationId)
  const thread = state.threads[conversationId]
  if (!conversation || !thread) throw `conversation not found: ${conversationId}`
  const path = activePath(thread)
  const messages = thread.compactSummary ? [...path, thread.compactSummary] : path
  const onPath = new Set(path.map((m) => m.id))
  return {
    conversation: { ...conversation, head_message_id: thread.head },
    tree: { messages, head_message_id: thread.head, branches: branchPoints(thread, path) },
    turns: thread.turns,
    pending_approvals: thread.pending.filter((p) => onPath.has(p.assistant_message_id)),
    plan_reviews: thread.planReviews.filter((r) => onPath.has(r.assistant_message_id)),
    plan_review_barrier: thread.planBarrier,
    sub_agent_runs: thread.subRuns,
    acp_notices: [],
  }
}
