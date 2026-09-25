import { decimal } from '@/lib/decimal'
import type {
  AssistantCreateRequest,
  AssistantUpdateRequest,
  ChatRequest,
  ComposerDraftUpsertRequest,
  ConversationInfoResponse,
  McpServerCreateRequest,
  McpServerUpdateRequest,
  MemoryInfoResponse,
  MemoryScopedUpsertRequest,
  ModelConfigInfoResponse,
  ModelConfigUpsertRequest,
  PendingApprovalInfoResponse,
  PreferenceKey,
  ProviderCreateRequest,
  ProviderInfoResponse,
  ProviderUpdateRequest,
  QueuedPromptCreateRequest,
  UsageDimension,
} from '@/types'
import { conversation, message } from './factories'
import type { DemoArgs, DemoBackend, DemoHandler } from './index'
import {
  APP_INFO,
  CAPABILITIES,
  IME_STATUS,
  STICKER_IMAGES,
  SKILL_BODY,
  TEMPLATE_VARIABLES,
  buildCatalog,
  buildMcpTools,
  buildToolCategories,
  buildToolNames,
  usageBuckets,
} from './settings'
import { DEMO_ROOT, PLAN_REVIEW_ID, PROJECT_MERIDIAN } from './conversations'
import { answerReplay, isReplaying, startReplay, stopReplay, tailOf } from './stream'
import { deleteSubtree, mintId, newestTip, snapshot, touchConversation } from './thread'
import { GIT_STATUS, gitDiff, readFile, tree } from './workspace'

/**
 * Command name → what the fixture backend answers.
 *
 * Reads return copies of the state (the transport clones every answer); writes
 * change it, so a rename, a delete or a saved setting survives until reload.
 * Commands missing here fall back to `fallback.ts`: an honest empty answer if
 * the schema has one, `DemoUnsupported` otherwise.
 */

type Rec = Record<string, unknown>

function request<T = Rec>(args: DemoArgs): T {
  const value = args?.request
  if (typeof value !== 'object' || value === null) throw 'demo: request argument is required'
  return value as T
}

function field<T>(args: DemoArgs, key: string): T {
  return args?.[key] as T
}

/** What the demo provider's model list names: every configured model, plus two
 *  more for Anthropic so the picker has something to add. */
function demoProviderModels(state: DemoBackend['state'], id: string): { id: string; name: string }[] {
  const configured = state.modelConfigs.filter((m) => m.provider_id === id).map((m) => m.model_id)
  const extra = id === 'demo-provider-anthropic' ? ['claude-opus-5', 'claude-sonnet-5-preview'] : []
  return [...configured, ...extra].map((model) => ({ id: model, name: model }))
}

function conversationOf(backend: DemoBackend, id: string): ConversationInfoResponse {
  const row = backend.state.conversations.find((c) => c.id === id)
  if (!row) throw `conversation not found: ${id}`
  return row
}

function patch<T extends object>(row: T, changes: object): T {
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'id' || value === undefined) continue
    ;(row as Rec)[key] = value
  }
  return row
}

const camelToSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

function snakePatch(row: object, changes: object) {
  const out: Rec = {}
  for (const [key, value] of Object.entries(changes)) out[camelToSnake(key)] = value
  return patch(row, out)
}

function allPending(backend: DemoBackend): PendingApprovalInfoResponse[] {
  return Object.values(backend.state.threads).flatMap((thread) => thread.pending)
}

/** Answers a fixture approval that is not part of a live replay: the tool row
 *  lands, the turn finishes, and the reload that `stop` triggers shows it. */
function settleFixtureApproval(backend: DemoBackend, approvalId: string, content: string, denied: boolean) {
  for (const [conversationId, thread] of Object.entries(backend.state.threads)) {
    const pending = thread.pending.find((p) => p.approval_id === approvalId)
    if (!pending) continue
    thread.pending = thread.pending.filter((p) => p.approval_id !== approvalId)
    const assistant = thread.all.find((m) => m.id === pending.assistant_message_id)
    const turnId = assistant?.turn_id ?? null
    const tool = message({
      id: mintId(backend.state, 'msg'),
      conversation_id: conversationId,
      role: 'tool',
      content,
      tool_call_id: pending.provider_call_id,
      tool_outcome: denied ? 'denied' : null,
      created_at: Date.now(),
      parent_id: thread.head,
      sort_order: thread.all.length,
      turn_id: turnId,
    })
    thread.all.push(tool)
    const reply = message({
      id: mintId(backend.state, 'msg'),
      conversation_id: conversationId,
      role: 'assistant',
      content: denied ? '好的，这一步不执行了。' : '完成了。（演示数据：这里不会真的执行任何东西。）',
      created_at: Date.now() + 1,
      parent_id: tool.id,
      sort_order: thread.all.length,
      turn_id: turnId,
    })
    thread.all.push(reply)
    thread.head = reply.id
    const record = thread.turns.find((t) => t.id === turnId)
    if (record) {
      record.status = 'done'
      record.phase = null
      record.phase_tool = null
      record.ended_at = Date.now()
    }
    touchConversation(backend.state, conversationId, reply.id)
    backend.emit('chat-stream', {
      type: 'tool_result',
      call_id: pending.provider_call_id,
      result: content,
      outcome: denied ? 'denied' : 'success',
      message_id: pending.assistant_message_id,
      conversation_id: conversationId,
    })
    backend.later(300, () =>
      backend.emit('chat-stream', {
        type: 'stop',
        reason: 'end_turn',
        message_id: reply.id,
        turn_id: turnId ?? mintId(backend.state, 'turn'),
        conversation_id: conversationId,
        input_tokens: 900,
        output_tokens: 40,
      }),
    )
    return
  }
  throw `approval not found: ${approvalId}`
}

function modelConfigFrom(backend: DemoBackend, req: ModelConfigUpsertRequest): ModelConfigInfoResponse {
  const now = Date.now()
  const existing = backend.state.modelConfigs.find(
    (m) => m.provider_id === req.provider_id && m.model_id === req.model_id,
  )
  const profile = {
    id: req.profile.id ?? mintId(backend.state, 'profile'),
    name: req.profile.name,
    context_window: req.profile.context_window,
    compact_threshold: req.profile.compact_threshold,
    max_output_tokens: req.profile.max_output_tokens,
    input_price: req.profile.input_price,
    output_price: req.profile.output_price,
    cache_read_price: req.profile.cache_read_price,
    cache_write_price: req.profile.cache_write_price,
    pricing_tiers: req.profile.pricing_tiers,
    capability_overrides: req.profile.capability_overrides,
    model_count: 1,
    created_at: existing?.profile.created_at ?? now,
    updated_at: now,
  }
  const row: ModelConfigInfoResponse = {
    id: existing?.id ?? mintId(backend.state, 'model'),
    provider_id: req.provider_id,
    model_id: req.model_id,
    profile,
    overrides_pricing: req.overrides_pricing,
    input_price: req.input_price,
    output_price: req.output_price,
    cache_read_price: req.cache_read_price,
    cache_write_price: req.cache_write_price,
    pricing_tiers: req.pricing_tiers,
    server_tools: req.server_tools,
    server_tool_price: req.server_tool_price,
    effective_pricing: req.overrides_pricing
      ? {
          input_price: req.input_price,
          output_price: req.output_price,
          cache_read_price: req.cache_read_price,
          cache_write_price: req.cache_write_price,
          pricing_tiers: req.pricing_tiers,
          server_tool_price: req.server_tool_price,
        }
      : {
          input_price: profile.input_price,
          output_price: profile.output_price,
          cache_read_price: profile.cache_read_price,
          cache_write_price: profile.cache_write_price,
          pricing_tiers: profile.pricing_tiers,
          server_tool_price: req.server_tool_price,
        },
    created_at: existing?.created_at ?? now,
    updated_at: now,
  }
  backend.state.modelConfigs = [...backend.state.modelConfigs.filter((m) => m.id !== row.id), row]
  return row
}

const conversations: Record<string, DemoHandler> = {
  list_conversations: (args, { state }) => {
    const archived = field<boolean>(args, 'archived') ?? false
    return state.conversations.filter((c) => c.is_archived === archived && c.parent_conversation_id === null)
  },
  list_conversations_by_project: (args, { state }) => {
    const req = request<{ projectId: string; archived: boolean }>(args)
    return state.conversations.filter(
      (c) => c.project_id === req.projectId && c.is_archived === req.archived && c.parent_conversation_id === null,
    )
  },
  create_conversation: (args, backend) => {
    const req = request<{ title: string | null; projectId: string | null }>(args)
    const now = Date.now()
    const row = conversation({
      id: mintId(backend.state, 'conv'),
      title: req.title,
      project_id: req.projectId,
      updated_at: now,
    })
    backend.state.conversations.unshift(row)
    backend.state.threads[row.id] = {
      all: [],
      head: null,
      compactSummary: null,
      turns: [],
      pending: [],
      planReviews: [],
      planBarrier: false,
      subRuns: [],
      shellResults: {},
      contextContents: {},
      todo: null,
    }
    return row
  },
  update_conversation_title: (args, backend) => {
    const req = request<{ id: string; title: string }>(args)
    conversationOf(backend, req.id).title = req.title
    return null
  },
  set_conversation_assistant: (args, backend) => {
    const req = request<{ id: string; assistantId: string | null }>(args)
    conversationOf(backend, req.id).assistant_id = req.assistantId
    return null
  },
  set_conversation_reasoning_prefs: (args, backend) => {
    const req = request<{ id: string; thinkingLevel: ConversationInfoResponse['thinking_level']; fastMode: boolean }>(
      args,
    )
    const row = conversationOf(backend, req.id)
    row.thinking_level = req.thinkingLevel
    row.fast_mode = req.fastMode
    return null
  },
  set_conversation_mode: (args, backend) => {
    const req = request<{ id: string; mode: ConversationInfoResponse['mode'] }>(args)
    conversationOf(backend, req.id).mode = req.mode
    return null
  },
  set_conversation_accept_edits: (args, backend) => {
    const req = request<{ id: string; acceptEdits: boolean }>(args)
    conversationOf(backend, req.id).accept_edits = req.acceptEdits
    return null
  },
  set_conversation_project: (args, backend) => {
    const req = request<{ id: string; projectId: string | null }>(args)
    conversationOf(backend, req.id).project_id = req.projectId
    return null
  },
  toggle_pin_conversation: (args, backend) => {
    const row = conversationOf(backend, field(args, 'id'))
    row.is_pinned = !row.is_pinned
    return row
  },
  toggle_archive_conversation: (args, backend) => {
    const row = conversationOf(backend, field(args, 'id'))
    row.is_archived = !row.is_archived
    return row
  },
  delete_conversation: (args, { state }) => {
    const id = field<string>(args, 'id')
    state.conversations = state.conversations.filter((c) => c.id !== id && c.parent_conversation_id !== id)
    delete state.threads[id]
    return null
  },
  search_conversations: (args, { state }) => {
    const req = request<{ query: string; limit: number | null }>(args)
    const query = req.query.toLowerCase()
    // eslint-disable-next-line meridian-ui/no-invented-domain-default -- a page size, the one `search_conversations` applies when none is asked for
    const pageSize = req.limit ?? 20
    return state.conversations
      .flatMap((c) => {
        const thread = state.threads[c.id]
        const hit = thread?.all.find(
          (m) => (m.role === 'user' || m.role === 'assistant') && m.content.toLowerCase().includes(query),
        )
        if (!hit || c.parent_conversation_id) return []
        const at = hit.content.toLowerCase().indexOf(query)
        return [
          {
            conversation_id: c.id,
            title: c.title,
            role: hit.role as 'user' | 'assistant',
            snippet: hit.content.slice(Math.max(0, at - 20), at + 60),
            created_at: hit.created_at,
          },
        ]
      })
      .slice(0, pageSize)
  },
  conversation_snapshot: (args, { state }) => snapshot(state, request<{ conversationId: string }>(args).conversationId),
  switch_branch: (args, { state }) => {
    const req = request<{ conversationId: string; messageId: string }>(args)
    const thread = state.threads[req.conversationId]
    thread.head = newestTip(thread, req.messageId)
    touchConversation(state, req.conversationId, thread.head)
    return null
  },
  delete_message: (args, { state }) => {
    const req = request<{ conversationId: string; id: string }>(args)
    const thread = state.threads[req.conversationId]
    deleteSubtree(thread, req.id)
    touchConversation(state, req.conversationId, thread.head)
    return null
  },
  rate_message: (args, { state }) => {
    const req = request<{ id: string; rating: -1 | 1 | null }>(args)
    for (const thread of Object.values(state.threads)) {
      const row = thread.all.find((m) => m.id === req.id)
      if (row) row.rating = req.rating
    }
    return null
  },
  read_message_context_item: (args, { state }) => {
    const req = request<{ conversationId: string; itemId: string }>(args)
    const thread = state.threads[req.conversationId]
    for (const row of thread?.all ?? []) {
      const descriptor = row.context_items.find((item) => item.id === req.itemId)
      if (descriptor) return { descriptor, content: thread.contextContents[req.itemId] ?? '' }
    }
    throw `context item not found: ${req.itemId}`
  },
  get_context_info: (args, { state }) => {
    const id = field<string>(args, 'conversationId')
    const convo = state.conversations.find((c) => c.id === id)
    const count = state.threads[id]?.all.length ?? 0
    return {
      estimated_tokens: 18_400 + count * 900,
      context_limit: 200_000,
      compact_threshold: 160_000,
      auto_compact_enabled: true,
      circuit_breaker_state: 'closed',
      message_count: count,
      model: 'claude-sonnet-5',
      agent_kind: convo?.agent_kind ?? null,
    }
  },
  get_active_todo_list: (args, { state }) => state.threads[field<string>(args, 'conversationId')]?.todo ?? null,
  compact: (args, backend) => {
    const id = request<{ conversationId: string }>(args).conversationId
    backend.emit('compact-start', { conversation_id: id, mid_turn: false, trigger: 'manual' })
    backend.later(1200, () =>
      backend.emit('compact-done', {
        conversation_id: id,
        mid_turn: false,
        trigger: 'manual',
        outcome: 'completed',
        tokens_reclaimed: 12_400,
        error: null,
      }),
    )
    return null
  },
  export_conversation: () => ({ path: 'C:\\Users\\demo\\Downloads\\conversation.jsonl' }),
  get_user_command_result: (args, { state }) => {
    const req = request<{ conversationId: string; messageId: string }>(args)
    return state.threads[req.conversationId]?.shellResults[req.messageId] ?? null
  },
  active_user_shell_turn: () => null,
}

const chat: Record<string, DemoHandler> = {
  chat: (args, backend) => {
    const req = request<ChatRequest>(args)
    const { state } = backend
    const thread = state.threads[req.conversationId]
    if (!thread) throw `conversation not found: ${req.conversationId}`
    if (isReplaying(state, req.conversationId)) throw 'A turn is already running in this conversation.'
    const turnId = req.turnId ?? mintId(state, 'turn')
    let parent = tailOf(backend, req.conversationId)
    let content = req.message
    if (req.replaces) {
      const replaced = thread.all.find((m) => m.id === req.replaces)
      parent = replaced?.parent_id ?? null
      // Regenerating re-asks the question above; editing asks a new one.
      if (req.message === null && replaced?.role === 'user') content = replaced.content
    }
    const convo = conversationOf(backend, req.conversationId)
    if (convo.title === null && content) {
      convo.title = content.slice(0, 24)
      backend.later(50, () => backend.emit('conversation-updated', { conversation_id: convo.id }))
    }
    startReplay(backend, req.conversationId, turnId, parent, content)
    return null
  },
  stop_chat: (args, { state }) => {
    stopReplay(state, request<{ conversationId: string }>(args).conversationId)
    return null
  },
  steer_conversation: () => {
    throw 'Nothing is running to steer in demo mode.'
  },
  approve_tool_call: (args, backend) => {
    const id = field<string>(args, 'approvalId')
    if (!answerReplay(backend.state, id, true))
      settleFixtureApproval(backend, id, '（演示）命令已执行，退出码 0。', false)
    return null
  },
  deny_tool_call: (args, backend) => {
    const req = request<{ approvalId: string; reason: string | null }>(args)
    if (!answerReplay(backend.state, req.approvalId, false)) {
      settleFixtureApproval(
        backend,
        req.approvalId,
        `The user denied this tool call.${req.reason ? ` ${req.reason}` : ''}`,
        true,
      )
    }
    return null
  },
  respond_to_ask: (args, backend) => {
    const req = request<{ approvalId: string; response: string }>(args)
    settleFixtureApproval(backend, req.approvalId, req.response, false)
    return null
  },
  all_pending_approvals: (_args, backend) => allPending(backend),
  run_user_command: (args, backend) => {
    const req = request<{ conversationId: string; turnId: string; command: string }>(args)
    const { state } = backend
    const thread = state.threads[req.conversationId]
    const id = mintId(state, 'msg')
    const stdout = `（演示）${req.command}\n这条命令没有真的执行。\n`
    const itemId = mintId(state, 'ctx')
    thread.all.push(
      message({
        id,
        conversation_id: req.conversationId,
        role: 'user',
        content: `!${req.command}`,
        source: 'shell',
        created_at: Date.now(),
        parent_id: tailOf(backend, req.conversationId),
        sort_order: thread.all.length,
        turn_id: req.turnId,
        context_items: [
          {
            id: itemId,
            position: 0,
            kind: 'shell_output',
            display_path: null,
            line_start: null,
            line_end: null,
            byte_count: stdout.length,
            line_count: 2,
            token_count: 12,
            truncated: false,
          },
        ],
      }),
    )
    thread.head = id
    thread.contextContents[itemId] = stdout
    const result = {
      conversation_id: req.conversationId,
      turn_id: req.turnId,
      message_id: id,
      status: 'completed' as const,
      stdout,
      stderr: '',
      exit_code: 0,
      timed_out: false,
      truncated: false,
      sandbox: 'host' as const,
      duration_ms: 12,
      cwd: DEMO_ROOT,
      host: 'DEMO-PC',
      error: null,
      can_retry_without_sandbox: false,
      retry_without_sandbox: false,
    }
    thread.shellResults[id] = result
    touchConversation(state, req.conversationId, id)
    return result
  },
  upload_file: (args) => {
    const path = request<{ filePath: string }>(args).filePath
    const name = path.split(/[\\/]/).pop() ?? path
    return { type: 'file', file: { url: `data:text/plain,${encodeURIComponent(name)}`, mime_type: 'text/plain', name } }
  },
  upload_file_bytes: (args) => {
    const req = request<{ fileName: string; dataBase64: string }>(args)
    const image = /\.(png|jpe?g|gif|webp)$/i.test(req.fileName)
    const url = `data:${image ? 'image/png' : 'application/octet-stream'};base64,${req.dataBase64}`
    return image
      ? { type: 'image_url', image_url: { url } }
      : { type: 'file', file: { url, mime_type: 'application/octet-stream', name: req.fileName } }
  },
  get_composer_draft: (args, { state }) =>
    state.drafts[request<{ conversationId: string | null }>(args).conversationId ?? ''] ?? null,
  save_composer_draft: (args, { state }) => {
    const req = request<ComposerDraftUpsertRequest>(args)
    const key = req.conversationId ?? ''
    const current = state.drafts[key]
    if (current && current.revision >= req.revision) return { applied: false, revision: current.revision }
    state.drafts[key] = {
      conversation_id: req.conversationId,
      body: req.body,
      attachments: req.attachments.map((a) => ({ ...a, exists: true })),
      conversation_refs: req.conversationRefs.map((id) => ({
        id,
        title: state.conversations.find((c) => c.id === id)?.title ?? null,
        exists: state.conversations.some((c) => c.id === id),
      })),
      sticker: state.emojis.find((e) => e.id === req.stickerId) ?? null,
      revision: req.revision,
      updated_at: Date.now(),
    }
    return { applied: true, revision: req.revision }
  },
  clear_composer_draft: (args, { state }) => {
    const req = request<{ conversationId: string | null; revision: number }>(args)
    const key = req.conversationId ?? ''
    const current = state.drafts[key]
    if (current && current.revision >= req.revision) return { applied: false, revision: current.revision }
    delete state.drafts[key]
    return { applied: true, revision: req.revision }
  },
  queue_list: (args, { state }) => state.queues[field<string>(args, 'conversationId')] ?? [],
  queue_enqueue: (args, backend) => {
    const req = request<QueuedPromptCreateRequest>(args)
    const queue = (backend.state.queues[req.conversationId] ??= [])
    const row = {
      id: mintId(backend.state, 'queue'),
      conversation_id: req.conversationId,
      content: req.content,
      delivery: req.delivery,
      position: queue.length,
      created_at: Date.now(),
      dispatched_at: null,
      dispatched_turn_id: null,
      settled_at: null,
      settled_message_id: null,
      held_at: null,
      reported_at: null,
    }
    queue.push(row)
    backend.later(0, () => backend.emit('queue-updated', { conversation_id: req.conversationId, delivered: false }))
    return row
  },
  queue_remove: (args, backend) => {
    const req = request<{ conversationId: string; id: string }>(args)
    backend.state.queues[req.conversationId] = (backend.state.queues[req.conversationId] ?? []).filter(
      (q) => q.id !== req.id,
    )
    backend.later(0, () => backend.emit('queue-updated', { conversation_id: req.conversationId, delivered: false }))
    return null
  },
}

const plan: Record<string, DemoHandler> = {
  get_plan_review: (args, { state }) => {
    if (request<{ reviewId: string }>(args).reviewId !== PLAN_REVIEW_ID) throw 'plan review not found'
    return state.planReview
  },
  list_plan_revisions: (_args, { state }) => [state.planReview.submitted_revision],
  get_plan_review_delivery: (_args, { state }) => state.planReview.delivery,
  save_plan_review_draft: (args, { state }) => {
    const req = request<{ expectedGeneration: number; normalizedMarkdown: string; globalNote: string | null }>(args)
    const draft = state.planReview.draft
    if (req.expectedGeneration !== draft.generation) throw 'The draft changed in another window.'
    draft.generation += 1
    draft.draft_normalized_markdown = req.normalizedMarkdown
    draft.global_note = req.globalNote
    draft.updated_at = Date.now()
    return {
      review_id: PLAN_REVIEW_ID,
      generation: draft.generation,
      draft_sha256: draft.draft_sha256,
      updated_at: draft.updated_at,
    }
  },
  discard_plan_review_draft: (_args, { state }) => {
    const draft = state.planReview.draft
    draft.generation += 1
    draft.draft_normalized_markdown = draft.base_normalized_markdown
    draft.global_note = null
    return state.planReview
  },
  decide_plan_review: (args, backend) => {
    const req = request<{ action: 'approve' | 'request_changes' }>(args)
    const { planReview, threads } = backend.state
    const status = req.action === 'approve' ? 'approved' : 'changes_requested'
    planReview.review.state = status
    planReview.review.lock_version += 1
    planReview.document.state = req.action === 'approve' ? 'approved' : 'drafting'
    for (const thread of Object.values(threads)) {
      for (const summary of thread.planReviews) {
        if (summary.review_id !== PLAN_REVIEW_ID) continue
        summary.status = status
        summary.lock_version = planReview.review.lock_version
        thread.planBarrier = false
        const record = thread.turns.find((t) => t.id === summary.turn_id)
        if (record) record.status = 'done'
        backend.later(0, () =>
          backend.emit('plan-review-updated', {
            review_id: PLAN_REVIEW_ID,
            conversation_id: summary.conversation_id,
            document_id: summary.document_id,
            revision_id: summary.revision_id,
            turn_id: summary.turn_id,
            status,
            delivery_state: null,
            lock_version: summary.lock_version,
          }),
        )
      }
    }
    return { review_id: PLAN_REVIEW_ID, state: status, delivery_state: null, continuation_turn_id: null }
  },
}

const projects: Record<string, DemoHandler> = {
  list_projects: (_args, { state }) => state.projects,
  create_project: (args, { state }) => {
    const req = request<{ name: string; path: string | null; description: string | null }>(args)
    const now = Date.now()
    const row = {
      id: mintId(state, 'project'),
      name: req.name,
      path: req.path,
      source_type: 'local' as const,
      source_id: null,
      assistant_id: null,
      description: req.description,
      created_at: now,
      updated_at: now,
    }
    state.projects.push(row)
    return row
  },
  update_project: (args, { state }) => {
    const req = request<{ id: string }>(args)
    const row = state.projects.find((p) => p.id === req.id)
    if (!row) throw 'project not found'
    return snakePatch(row, req)
  },
  delete_project: (args, { state }) => {
    const id = field<string>(args, 'id')
    state.projects = state.projects.filter((p) => p.id !== id)
    for (const c of state.conversations) if (c.project_id === id) c.project_id = null
    return null
  },
  workspace_root: (args, { state }) => {
    const convo = state.conversations.find((c) => c.id === request<{ conversationId: string }>(args).conversationId)
    if (!convo?.project_id) return { state: 'no_project' }
    const project = state.projects.find((p) => p.id === convo.project_id)
    if (!project?.path) return { state: 'no_path' }
    return { state: 'ok', root: project.path, git_available: true, is_repo: convo.project_id === PROJECT_MERIDIAN }
  },
  workspace_tree: (args) => tree(request<{ dir: string | null }>(args).dir),
  workspace_read_file: (args) => {
    const rel = request<{ relPath: string }>(args).relPath
    const file = readFile(rel)
    if (!file) throw `No such file: ${rel}`
    return file
  },
  workspace_probe_ref: (args) => {
    const path = request<{ path: string }>(args).path
    if (readFile(path)) return { kind: 'project_file', path }
    throw `not a workspace path: ${path}`
  },
  workspace_resolve_ref: (args) => {
    const req = request<{ path: string; lineStart: number | null; lineEnd: number | null }>(args)
    const file = readFile(req.path)
    if (!file) throw `No such file: ${req.path}`
    return {
      kind: 'project_file',
      path: req.path,
      content: file.content,
      line_start: req.lineStart,
      line_end: req.lineEnd,
      byte_count: file.size_bytes,
      line_count: file.total_lines,
      token_count: Math.ceil(file.size_bytes / 4),
      truncated: false,
    }
  },
  workspace_suggest_refs: (args) => {
    const query = request<{ query: string }>(args).query.toLowerCase()
    return tree(null)
      .concat(tree('src/lib'), tree('src/components/chat'))
      .filter((entry) => entry.rel_path.toLowerCase().includes(query))
      .map((entry) => ({ path: entry.rel_path, name: entry.name, is_dir: entry.is_dir }))
  },
  workspace_git_status: () => GIT_STATUS,
  workspace_git_diff: (args) => ({
    diff_text: gitDiff(request<{ relPath: string | null }>(args).relPath),
    truncated: false,
  }),
  open_in_editor: () => {
    throw 'Opening an editor is not available in the browser.'
  },
}

const providers: Record<string, DemoHandler> = {
  list_providers: (_args, { state }) => state.providers,
  list_provider_catalog: () => buildCatalog(),
  codex_auth_status: () => ({
    logged_in: false,
    email: null,
    plan: null,
    storage: null,
    codex_home: null,
    problem: 'Not signed in (demo data).',
  }),
  create_provider: (args, { state }) => {
    const req = request<ProviderCreateRequest>(args)
    const now = Date.now()
    const row: ProviderInfoResponse = {
      id: mintId(state, 'provider'),
      name: req.name,
      provider_type: req.providerType,
      base_url: req.baseUrl,
      is_enabled: true,
      sort_order: state.providers.length,
      created_at: now,
      updated_at: now,
      api_format: req.apiFormat ?? 'chat_completions',
      catalog_id: req.catalogId,
      credential_kind: 'api_key',
      transport_profile: 'standard',
      icon: null,
      codex_request_shape: false,
    }
    state.providers.push(row)
    return row
  },
  update_provider: (args, { state }) => {
    const req = request<ProviderUpdateRequest>(args)
    const row = state.providers.find((p) => p.id === req.id)
    if (!row) throw 'provider not found'
    snakePatch(row, req)
    row.updated_at = Date.now()
    return row
  },
  delete_provider: (args, { state }) => {
    const id = field<string>(args, 'id')
    state.providers = state.providers.filter((p) => p.id !== id)
    state.modelConfigs = state.modelConfigs.filter((m) => m.provider_id !== id)
    return null
  },
  set_provider_key: (args, { state }) => {
    state.providerKeys.add(request<{ providerId: string }>(args).providerId)
    return null
  },
  get_provider_key_exists: (args, { state }) => state.providerKeys.has(field(args, 'providerId')),
  fetch_provider_models: (args, { state }) =>
    demoProviderModels(state, request<{ providerId: string }>(args).providerId),
  // As if a fetch had already been made: the cache holds what it would return.
  list_cached_provider_models: (args, { state }) =>
    demoProviderModels(state, request<{ providerId: string }>(args).providerId),
  get_provider_capabilities: () => CAPABILITIES,
  get_provider_balance: (args) =>
    field(args, 'providerId') === 'demo-provider-deepseek'
      ? {
          is_available: true,
          accounts: [
            {
              currency: 'CNY',
              total_balance: decimal('86.42'),
              granted_balance: decimal('10'),
              topped_up_balance: decimal('76.42'),
            },
          ],
        }
      : null,
  list_model_configs: (args, { state }) =>
    state.modelConfigs.filter((m) => m.provider_id === field(args, 'providerId')),
  list_model_profiles: (_args, { state }) => state.modelConfigs.map((m) => m.profile),
  get_model_config: (args, { state }) => {
    const req = request<{ providerId: string; modelId: string }>(args)
    return state.modelConfigs.find((m) => m.provider_id === req.providerId && m.model_id === req.modelId) ?? null
  },
  save_model_config: (args, backend) => modelConfigFrom(backend, request<ModelConfigUpsertRequest>(args)),
  delete_model_config: (args, { state }) => {
    const id = field<string>(args, 'id')
    state.modelConfigs = state.modelConfigs.filter((m) => m.id !== id)
    return null
  },
  usage_report: (args, { state }) => usageBuckets(request<{ dimension: UsageDimension }>(args).dimension, state.now),
}

const assistants: Record<string, DemoHandler> = {
  list_assistants: (_args, { state }) => state.assistants,
  create_assistant: (args, { state }) => {
    const req = request<AssistantCreateRequest>(args)
    const now = Date.now()
    const row = {
      ...state.assistants[0],
      id: mintId(state, 'assistant'),
      name: req.name,
      system_prompt: req.systemPrompt,
      model_id: req.modelId,
      temperature: req.temperature,
      top_p: req.topP,
      max_tokens: req.maxTokens,
      is_default: false,
      sort_order: state.assistants.length,
      created_at: now,
      updated_at: now,
    }
    state.assistants.push(row)
    return row
  },
  update_assistant: (args, { state }) => {
    const req = request<AssistantUpdateRequest>(args)
    const row = state.assistants.find((a) => a.id === req.id)
    if (!row) throw 'assistant not found'
    snakePatch(row, req)
    row.updated_at = Date.now()
    return row
  },
  delete_assistant: (args, { state }) => {
    const id = field<string>(args, 'id')
    state.assistants = state.assistants.filter((a) => a.id !== id)
    return null
  },
  list_tool_categories: (_args, { state }) => buildToolCategories(state.now),
  list_custom_tools: (_args, { state }) => state.customTools,
  delete_custom_tool: (args, { state }) => {
    const id = field<string>(args, 'id')
    state.customTools = state.customTools.filter((t) => t.id !== id)
    return null
  },
  list_tool_presets: (_args, { state }) => state.toolPresets,
  delete_tool_preset: (args, { state }) => {
    const id = field<string>(args, 'id')
    state.toolPresets = state.toolPresets.filter((t) => t.id !== id)
    return null
  },
  list_all_tool_names: () => buildToolNames(),
  list_skills: (_args, { state }) => state.skills,
  rescan_skills: (_args, { state }) => state.skills,
  get_skill_body: () => SKILL_BODY,
  update_skill: (args, { state }) => {
    const req = request<{ dirName: string }>(args)
    const row = state.skills.find((s) => s.dir_name === req.dirName)
    if (!row) throw 'skill not found'
    const { dirName: _dir, ...rest } = req as Rec
    snakePatch(row, rest)
    return row
  },
  list_skill_bindings: (args, { state }) => {
    const req = request<{ layer: string; anchorId: string | null }>(args)
    return state.skillBindings[`${req.layer}:${req.anchorId ?? ''}`] ?? []
  },
  set_skill_binding: (args, { state }) => {
    const req = request<{ layer: string; anchorId: string | null; dirName: string; bound: boolean }>(args)
    const key = `${req.layer}:${req.anchorId ?? ''}`
    const names = new Set(state.skillBindings[key] ?? [])
    if (req.bound) names.add(req.dirName)
    else names.delete(req.dirName)
    state.skillBindings[key] = [...names]
    return state.skillBindings[key]
  },
  list_template_variables: () => TEMPLATE_VARIABLES,
}

const mcp: Record<string, DemoHandler> = {
  list_mcp_servers: (_args, { state }) => state.mcpServers,
  create_mcp_server: (args, { state }) => {
    const req = request<McpServerCreateRequest>(args)
    const now = Date.now()
    const row = {
      id: mintId(state, 'mcp'),
      name: req.name,
      transport_type: req.transportType,
      command: req.command,
      args: req.args,
      env: req.env,
      url: req.url,
      headers: req.headers,
      is_enabled: true,
      sort_order: state.mcpServers.length,
      created_at: now,
      updated_at: now,
    }
    state.mcpServers.push(row)
    return row
  },
  update_mcp_server: (args, { state }) => {
    const req = request<McpServerUpdateRequest>(args)
    const row = state.mcpServers.find((s) => s.id === req.id)
    if (!row) throw 'server not found'
    snakePatch(row, req)
    row.updated_at = Date.now()
    return row
  },
  delete_mcp_server: (args, { state }) => {
    const id = field<string>(args, 'id')
    state.mcpServers = state.mcpServers.filter((s) => s.id !== id)
    state.mcpConnected.delete(id)
    return null
  },
  connect_mcp_server: (args, { state }) => {
    state.mcpConnected.add(field(args, 'id'))
    return null
  },
  disconnect_mcp_server: (args, { state }) => {
    state.mcpConnected.delete(field(args, 'id'))
    return null
  },
  list_mcp_tools: (args, { state }) => {
    const serverId = field<string | null>(args, 'serverId')
    return buildMcpTools().filter(
      (t) =>
        state.mcpConnected.has(t.server_id) &&
        (serverId === null || serverId === undefined || t.server_id === serverId),
    )
  },
  list_mcp_connection_statuses: (_args, { state }) =>
    state.mcpServers
      .filter((s) => s.is_enabled)
      .map((s) => ({
        server_id: s.id,
        state: state.mcpConnected.has(s.id) ? ('connected' as const) : ('disconnected' as const),
        tool_count: state.mcpConnected.has(s.id) ? buildMcpTools().filter((t) => t.server_id === s.id).length : 0,
      })),
}

const memories: Record<string, DemoHandler> = {
  list_all_memories: (_args, { state }) => state.memories,
  list_memories: (args, { state }) =>
    state.memories.filter((m) => m.scope_type === 'project' && m.scope_id === field(args, 'projectId')),
  list_memory_subjects: (_args, { state }) => state.memorySubjects,
  list_memory_trash: (_args, { state }) => state.memoryTrash,
  memory_enums: () => ({
    scopes: ['project', 'client_global', 'onebot_global', 'onebot_user'],
    origins: ['private', 'group', 'admin', 'desktop', 'legacy'],
    visibilities: ['normal', 'owner_only'],
    memory_types: ['general', 'preference', 'fact', 'instruction', 'relationship'],
  }),
  save_memory_scoped: (args, { state }) => {
    const req = request<MemoryScopedUpsertRequest>(args)
    const now = Date.now()
    const row: MemoryInfoResponse = {
      id: mintId(state, 'memory'),
      scope_type: req.scope,
      scope_id:
        req.scope === 'project'
          ? (req.projectId ?? '')
          : req.scope === 'onebot_user'
            ? (req.subjectScopeId ?? '')
            : req.scope === 'client_global'
              ? 'client'
              : 'onebot',
      key: req.key,
      content: req.content,
      memory_type: req.memoryType ?? 'general',
      subject_scope_id: req.subjectScopeId,
      origin: 'desktop',
      visibility: req.ownerOnly ? 'owner_only' : 'normal',
      source_session_id: null,
      deleted_at: null,
      deleted_by: null,
      created_at: now,
      updated_at: now,
    }
    state.memories.unshift(row)
    return row
  },
  update_memory: (args, { state }) => {
    const req = request<{
      id: string
      content?: string
      memoryType?: MemoryInfoResponse['memory_type']
      ownerOnly?: boolean
    }>(args)
    const row = state.memories.find((m) => m.id === req.id)
    if (!row) throw 'memory not found'
    if (req.content !== undefined) row.content = req.content
    if (req.memoryType !== undefined) row.memory_type = req.memoryType
    if (req.ownerOnly !== undefined) row.visibility = req.ownerOnly ? 'owner_only' : 'normal'
    row.updated_at = Date.now()
    return row
  },
  delete_memories: (args, { state }) => {
    const ids = new Set(field<string[]>(args, 'ids'))
    const gone = state.memories.filter((m) => ids.has(m.id))
    state.memories = state.memories.filter((m) => !ids.has(m.id))
    state.memoryTrash.unshift(...gone.map((m) => ({ ...m, deleted_at: Date.now(), deleted_by: 'self' as const })))
    return gone.length
  },
  delete_memory: (args, { state }) => {
    const id = field<string>(args, 'id')
    state.memories = state.memories.filter((m) => m.id !== id)
    return null
  },
  restore_memories: (args, { state }) => {
    const ids = new Set(field<string[]>(args, 'ids'))
    const back = state.memoryTrash.filter((m) => ids.has(m.id))
    state.memoryTrash = state.memoryTrash.filter((m) => !ids.has(m.id))
    state.memories.unshift(...back.map((m) => ({ ...m, deleted_at: null, deleted_by: null })))
    return back.length
  },
  purge_memories: (args, { state }) => {
    const ids = new Set(field<string[]>(args, 'ids'))
    const before = state.memoryTrash.length
    state.memoryTrash = state.memoryTrash.filter((m) => !ids.has(m.id))
    return before - state.memoryTrash.length
  },
  forget_memory_subject: (args, { state }) => {
    const id = field<string>(args, 'subjectScopeId')
    const before = state.memories.length
    state.memories = state.memories.filter((m) => m.subject_scope_id !== id)
    state.memorySubjects = state.memorySubjects.filter((s) => s.scope_id !== id)
    return before - state.memories.length
  },
  set_memory_subject_flags: (args, { state }) => {
    const req = request<{ subjectScopeId: string; isPinned: boolean | null; optedOut: boolean | null }>(args)
    const row = state.memorySubjects.find((s) => s.scope_id === req.subjectScopeId)
    if (row && req.isPinned !== null) row.is_pinned = req.isPinned
    if (row && req.optedOut !== null) row.opted_out = req.optedOut
    return null
  },
}

const system: Record<string, DemoHandler> = {
  get_platform: () => 'windows',
  get_window_insets: () => ({ top: 0, right: 0, bottom: 0, left: 0, imeBottom: 0 }),
  get_app_info: () => APP_INFO,
  get_secret: () => null,
  get_preference: (args, { state }) => {
    const key = request<{ key: PreferenceKey }>(args).key
    return { key, value: state.preferences[key] }
  },
  set_preference: (args, { state }) => {
    const req = request<{ key: PreferenceKey; value: unknown }>(args)
    ;(state.preferences as Rec)[req.key] =
      req.value !== null && typeof req.value === 'object' && 'providerId' in req.value
        ? { provider_id: (req.value as Rec).providerId, model_id: (req.value as Rec).modelId }
        : req.value
    return null
  },
  get_service_key_exists: (args, { state }) => state.serviceKeys.has(field(args, 'service')),
  set_service_key: (args, { state }) => {
    state.serviceKeys.add(request<{ service: string }>(args).service)
    return null
  },
  read_logs: (args, { state }) => {
    const req = request<{ minLevel: string | null; contains: string | null }>(args)
    const rank = { debug: 0, info: 1, warn: 2, error: 3 } as Record<string, number>
    const floor = rank[req.minLevel ?? 'debug'] ?? 0
    const needle = req.contains?.toLowerCase() ?? ''
    return {
      entries: state.logs.filter(
        (e) => rank[e.level.toLowerCase()] >= floor && (!needle || e.msg.toLowerCase().includes(needle)),
      ),
      nextCursor: null,
      scanTruncated: false,
      filesScanned: ['meridian.log'],
    }
  },
  list_log_files: () => [
    { name: 'meridian.log', size: 1_204_400 },
    { name: 'meridian.log.1', size: 5_242_880 },
  ],
  get_log_settings: (_args, { state }) => ({
    level: state.logLevel,
    levels: ['error', 'warn', 'info', 'debug'],
    directory: 'C:\\Users\\demo\\AppData\\Roaming\\Meridian\\logs',
    maxFileBytes: 5_242_880,
    maxFiles: 5,
    available: true,
  }),
  set_log_level: (args, { state }) => {
    state.logLevel = request<{ level: typeof state.logLevel }>(args).level
    return null
  },
  export_logs: () => ({ bytesWritten: 6_447_280 }),
}

const integrations: Record<string, DemoHandler> = {
  get_onebot_config: (_args, { state }) => state.onebot,
  save_onebot_config: (args, { state }) => {
    state.onebot = { ...request<typeof state.onebot>(args) }
    return null
  },
  get_onebot_status: (_args, { state }) => ({
    enabled: state.onebot.enabled,
    running: state.onebotRunning,
    connected_clients: state.onebotRunning ? 1 : 0,
    host: state.onebot.host,
    port: state.onebot.port,
  }),
  start_onebot: (_args, { state }) => {
    state.onebotRunning = true
    return null
  },
  stop_onebot: (_args, { state }) => {
    state.onebotRunning = false
    return null
  },
  get_voice_send_readiness: () => ({
    enabled: true,
    has_model: true,
    has_reference_id: true,
    has_api_key: false,
    ready: false,
  }),
  list_voice_corpus: (_args, { state }) => state.voiceCorpus,
  voice_model_status: () => ({
    installed: true,
    path: 'C:\\Users\\demo\\AppData\\Roaming\\Meridian\\models\\sense-voice',
    size_bytes: 239_000_000,
    downloading: false,
  }),
  get_hooks_config: (_args, { state }) => state.hooks,
  save_hooks_config: (args, { state }) => {
    state.hooks = { ...request<typeof state.hooks>(args) }
    return state.hooks
  },
  get_hooks_status: (_args, { state }) => ({
    enabled: state.hooks.enabled,
    running: state.hooks.enabled,
    host: state.hooks.host,
    port: state.hooks.port,
    handshake_path: 'C:\\Users\\demo\\AppData\\Roaming\\Meridian\\plan-gate.json',
  }),
  get_listen_config: (_args, { state }) => state.listen,
  get_listen_status: (_args, { state }) => ({
    enabled: state.listen.enabled,
    running: state.listenRunning,
    host: state.listen.host,
    port: state.listen.port,
    connections: 0,
  }),
  get_listen_addresses: () => ['192.168.1.20', '100.64.0.7'],
  get_ime_status: () => IME_STATUS,
  get_ime_config: (_args, { state }) => state.ime,
  save_ime_config: (args, { state }) => {
    state.ime = { ...request<typeof state.ime>(args) }
    return state.ime
  },
  list_ime_dictionaries: (_args, { state }) => state.imeDictionaries,
  set_ime_dictionary_enabled: (args, { state }) => {
    const req = request<{ file: string; enabled: boolean }>(args)
    const row = state.imeDictionaries.find((d) => d.file === req.file)
    if (row) row.enabled = req.enabled
    return state.imeDictionaries
  },
  acp_get_config: () => ({ command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'] }),
}

const emoji: Record<string, DemoHandler> = {
  list_emoji_packs: (_args, { state }) => state.emojiPacks,
  list_assistant_emoji_packs: (_args, { state }) => state.emojiPacks,
  list_emojis: (args, { state }) => state.emojis.filter((e) => e.pack_id === field(args, 'packId')),
  search_emojis: (args, { state }) => {
    const query = field<string>(args, 'query').toLowerCase()
    return state.emojis.filter((e) => e.name.toLowerCase().includes(query) || (e.tags ?? '').includes(query))
  },
  get_emoji_file_url: (args) => {
    const url = STICKER_IMAGES[field<string>(args, 'emojiId')]
    if (!url) throw 'sticker not found'
    return url
  },
  rename_emoji: (args, { state }) => {
    const req = request<{ id: string; newName: string }>(args)
    const row = state.emojis.find((e) => e.id === req.id)
    if (!row) throw 'sticker not found'
    row.name = req.newName
    return row
  },
}

export const DEMO_HANDLERS: Record<string, DemoHandler> = {
  ...conversations,
  ...chat,
  ...plan,
  ...projects,
  ...providers,
  ...assistants,
  ...mcp,
  ...memories,
  ...system,
  ...integrations,
  ...emoji,
}
