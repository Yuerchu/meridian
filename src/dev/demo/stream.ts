import type { ChatStreamEvent, MessageInfoResponse, ToolOutcome } from '@/types'
import { call, message, turn, usage } from './factories'
import type { DemoBackend } from './index'
import type { DemoState } from './state'
import { activePath, mintId, touchConversation } from './thread'

/**
 * A prerecorded turn, played back when somebody sends a message.
 *
 * It exercises every live state the transcript has: reasoning streaming in,
 * prose streaming in, a tool that runs and returns, a second round, and a
 * command that stops and asks for approval. Every row is written to the
 * in-memory tree as it is announced, so the reload that follows `stop` — or one
 * that happens halfway — reads back exactly what was streamed, the way the
 * real backend's `append_message` makes it.
 */

const TICK_MS = 45

interface Replay {
  conversationId: string
  turnId: string
  cancelled: boolean
  /** Resumes the turn once its approval is answered. */
  onApproval: ((approved: boolean) => void) | null
  approvalId: string | null
}

/** Per backend, so two backends (two tests) never share a running turn. */
const replaysByState = new WeakMap<DemoState, Map<string, Replay>>()

function replaysOf(state: DemoState): Map<string, Replay> {
  let replays = replaysByState.get(state)
  if (!replays) {
    replays = new Map()
    replaysByState.set(state, replays)
  }
  return replays
}

function chunks(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

function emit(backend: DemoBackend, event: ChatStreamEvent) {
  backend.emit('chat-stream', event)
}

/** Resolves after `ms` with whether the replay is still wanted. */
function wait(backend: DemoBackend, replay: Replay, ms: number): Promise<boolean> {
  return new Promise((resolve) => backend.later(ms, () => resolve(!replay.cancelled)))
}

export function isReplaying(state: DemoState, conversationId: string): boolean {
  return replaysOf(state).has(conversationId)
}

export function startReplay(
  backend: DemoBackend,
  conversationId: string,
  turnId: string,
  parentId: string | null,
  userContent: string | null,
) {
  const { state } = backend
  const thread = state.threads[conversationId]
  const replay: Replay = { conversationId, turnId, cancelled: false, onApproval: null, approvalId: null }
  const replays = replaysOf(state)
  replays.set(conversationId, replay)
  const now = Date.now()

  thread.turns.push(
    turn({ id: turnId, started_at: now, status: 'running', phase: 'streaming', ended_at: null, usage: null }),
  )
  const record = () => thread.turns.find((t) => t.id === turnId)!

  let cursor = parentId
  const write = (over: Partial<MessageInfoResponse> & Pick<MessageInfoResponse, 'role' | 'content'>) => {
    const row = message({
      id: mintId(state, 'msg'),
      conversation_id: conversationId,
      created_at: Date.now(),
      parent_id: cursor,
      sort_order: thread.all.length,
      turn_id: turnId,
      ...over,
    })
    thread.all.push(row)
    thread.head = row.id
    cursor = row.id
    touchConversation(state, conversationId, row.id)
    return row
  }

  if (userContent !== null) write({ role: 'user', content: userContent })

  const finish = (reason: 'end_turn' | 'cancelled', lastMessageId: string | null) => {
    const t = record()
    t.status = reason === 'cancelled' ? 'cancelled' : 'done'
    t.phase = null
    t.phase_tool = null
    t.ended_at = Date.now()
    t.usage = usage(3120, 486, 2048, '0.0114')
    replays.delete(conversationId)
    emit(backend, {
      type: 'stop',
      reason,
      message_id: lastMessageId,
      turn_id: turnId,
      conversation_id: conversationId,
      input_tokens: 3120,
      output_tokens: 486,
    })
  }

  /** Streams one assistant round; returns its row, or null if stopped. */
  const round = async (reasoning: string | null, text: string): Promise<MessageInfoResponse | null> => {
    const row = write({ role: 'assistant', content: '' })
    emit(backend, { type: 'message_start', message_id: row.id, turn_id: turnId, conversation_id: conversationId })
    if (reasoning) {
      for (const piece of chunks(reasoning, 6)) {
        if (!(await wait(backend, replay, TICK_MS))) return null
        row.reasoning_content = (row.reasoning_content ?? '') + piece
        emit(backend, { type: 'reasoning', content: piece, message_id: row.id, conversation_id: conversationId })
      }
    }
    for (const piece of chunks(text, 4)) {
      if (!(await wait(backend, replay, TICK_MS))) return null
      row.content += piece
      emit(backend, { type: 'text', content: piece, message_id: row.id, conversation_id: conversationId })
    }
    return row
  }

  const tool = (row: MessageInfoResponse, callId: string, name: string, args: Record<string, unknown>) => {
    const c = call(callId, name, args)
    row.tool_calls = [...(row.tool_calls ?? []), c]
    emit(backend, {
      type: 'tool_call',
      call_id: callId,
      tool_name: name,
      arguments: c.function.arguments,
      message_id: row.id,
      conversation_id: conversationId,
    })
    return c
  }

  const result = (row: MessageInfoResponse, callId: string, content: string, outcome: ToolOutcome) => {
    write({ role: 'tool', content, tool_call_id: callId, tool_outcome: outcome === 'success' ? null : outcome })
    emit(backend, {
      type: 'tool_result',
      call_id: callId,
      result: content,
      outcome,
      message_id: row.id,
      conversation_id: conversationId,
    })
  }

  void (async () => {
    const first = await round(
      '用户发来了新消息。先读一下相关文件确认现状，再决定要不要跑命令。',
      '我先看一下项目里的相关实现。',
    )
    if (!first) return finish('cancelled', thread.head)
    const readId = mintId(state, 'call')
    tool(first, readId, 'read_file', { path: 'src/lib/transport.ts' })
    if (!(await wait(backend, replay, 500))) return finish('cancelled', first.id)
    result(first, readId, 'export const transport: Transport = remote ?? demo ?? tauriTransport\n', 'success')

    const second = await round(null, '实现看过了。接下来需要跑一次测试来确认，这一步需要你批准。')
    if (!second) return finish('cancelled', thread.head)
    const cmdId = mintId(state, 'call')
    const cmd = tool(second, cmdId, 'run_command', { command: 'pnpm test', description: '跑全量测试' })
    const approvalId = mintId(state, 'approval')
    replay.approvalId = approvalId
    const t = record()
    t.phase = 'awaiting_approval'
    t.phase_tool = 'run_command'
    // Stamped once, as the backend does: the event and the register agree.
    const askedAt = Date.now()
    thread.pending.push({
      approval_id: approvalId,
      conversation_id: conversationId,
      assistant_message_id: second.id,
      provider_call_id: cmdId,
      tool_name: 'run_command',
      arguments: cmd.function.arguments,
      retry: null,
      asked_at: askedAt,
      bubbled: false,
      parent_call_id: null,
      sub_conversation_id: null,
    })
    emit(backend, {
      type: 'tool_approval_req',
      approval_id: approvalId,
      call_id: cmdId,
      tool_name: 'run_command',
      arguments: cmd.function.arguments,
      message_id: second.id,
      conversation_id: conversationId,
      delegation: null,
      retry: null,
      asked_at: askedAt,
    })

    const approved = await new Promise<boolean>((resolve) => {
      replay.onApproval = resolve
    })
    thread.pending = thread.pending.filter((p) => p.approval_id !== approvalId)
    if (replay.cancelled) return finish('cancelled', second.id)
    t.phase = 'running_tool'
    if (approved) {
      if (!(await wait(backend, replay, 900))) return finish('cancelled', second.id)
      result(
        second,
        cmdId,
        ' Test Files  212 passed (212)\n      Tests  3104 passed (3104)\n   Duration  48.2s',
        'success',
      )
    } else {
      result(second, cmdId, 'The user denied this tool call.', 'denied')
    }
    t.phase = 'streaming'
    const last = await round(
      null,
      approved
        ? '全部测试通过（212 个文件、3104 个用例）。这是演示数据回放的一段预录回复。'
        : '好的，没有运行测试。这是演示数据回放的一段预录回复。',
    )
    finish(last ? 'end_turn' : 'cancelled', last?.id ?? thread.head)
  })()
}

/** Answers the replay's pending approval, if this id is it. */
export function answerReplay(state: DemoState, approvalId: string, approved: boolean): boolean {
  for (const replay of replaysOf(state).values()) {
    if (replay.approvalId === approvalId && replay.onApproval) {
      replay.onApproval(approved)
      replay.onApproval = null
      return true
    }
  }
  return false
}

export function stopReplay(state: DemoState, conversationId: string) {
  const replay = replaysOf(state).get(conversationId)
  if (!replay) return
  replay.cancelled = true
  replay.onApproval?.(false)
}

/** The last row on the active path, for a new question to hang off. */
export function tailOf(backend: DemoBackend, conversationId: string): string | null {
  const path = activePath(backend.state.threads[conversationId])
  return path.length > 0 ? path[path.length - 1].id : null
}
