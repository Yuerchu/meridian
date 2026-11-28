import { demoLocalModel } from './local-model'
import { decimal } from '@/lib/decimal'
import { parseCustomToolExecution } from '@/lib/custom-tool-execution'
import type {
  ApprovalDecisionRequest,
  AssistantCreateRequest,
  AssistantUpdateRequest,
  BackgroundTaskListRequest,
  BackgroundTaskOutputReadRequest,
  BackgroundTaskStopRequest,
  BoardStage,
  BoardTaskCreateRequest,
  BoardTaskInfoResponse,
  BoardTaskStartRequest,
  BoardTaskUpdateRequest,
  ChatStartRequest,
  ComposerDraftDeleteRequest,
  ComposerDraftReadRequest,
  ComposerDraftUpsertRequest,
  ConversationCreateRequest,
  ConversationInfoResponse,
  ConversationListRequest,
  ConversationUpdateRequest,
  CustomToolCreateRequest,
  CustomToolInfoResponse,
  CustomToolUpdateRequest,
  DreamConfigUpdateRequest,
  DreamRunInfoResponse,
  DreamRunListRequest,
  DreamRunRestoreRequest,
  DreamRunStartRequest,
  LocalModelInspectRequest,
  LogicalModelCreateRequest,
  LogicalModelDeleteRequest,
  LogicalModelInfoResponse,
  LogicalModelUpdateRequest,
  McpDefaultPolicyUpdateRequest,
  McpServerApproveAlwaysToolsRequest,
  McpServerCreateRequest,
  McpServerPolicyUpdateRequest,
  McpServerUpdateRequest,
  McpToolEnabledUpdateRequest,
  McpToolListRequest,
  McpToolPolicyUpdateRequest,
  MediaGenerationCancelRequest,
  MediaGenerationCreateRequest,
  MediaGenerationDeleteRequest,
  MediaGenerationExportRequest,
  MediaGenerationInfoResponse,
  MediaGenerationListRequest,
  MediaGenerationReadRequest,
  MemoryCreateRequest,
  MemoryDeleteRequest,
  MemoryInfoResponse,
  MemoryListRequest,
  MemoryRestoreRequest,
  MemorySubjectDeleteRequest,
  MemorySubjectUpdateRequest,
  MemoryUpdateRequest,
  ModelConfigInfoResponse,
  ModelConfigUpsertRequest,
  ModelDeploymentAttachRequest,
  ModelDeploymentDeleteRequest,
  ModelDeploymentProfileSwitchRequest,
  ModelDeploymentUpdateRequest,
  ModelProfileInfoResponse,
  PendingApprovalInfoResponse,
  PreferenceKey,
  ProviderCreateRequest,
  ProviderInfoResponse,
  ProviderLocalModelReadRequest,
  ProviderModelListRequest,
  ProviderUpdateRequest,
  QueuedPromptCreateRequest,
  RemoteConfigUpdateRequest,
  SkillBindingListRequest,
  SkillBindingUpdateRequest,
  SkillUpdateRequest,
  UsageDimension,
  UserCommandRunRequest,
  WorkspaceFileReadRequest,
  WorkspaceGitDiffRequest,
  WorkspaceReferenceProbeRequest,
  WorkspaceReferenceResolveRequest,
  WorkspaceReferenceSuggestRequest,
} from '@/types'
import { conversation, message } from './factories'
import type { DemoArgs, DemoBackend, DemoHandler } from './index'
import type { DemoState } from './state'
import {
  APP_INFO,
  CAPABILITIES,
  IME_LM_STATUS,
  IME_STATUS,
  SKILL_BODY,
  buildCatalog,
  buildMcpTools,
  buildToolCategories,
  buildToolNames,
  usageBuckets,
  usageCacheMisses,
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

/** What the demo provider's model list names: every configured model, plus two
 *  more for Anthropic so the picker has something to add. */
function demoProviderModels(
  state: DemoBackend['state'],
  id: string,
): {
  id: string
  name: string
  suggested_canonical_id: string | null
  suggested_protocol: string | null
  suggested_domain: 'chat' | 'image_gen' | 'video_gen' | 'web_search' | 'tts' | 'embedding'
}[] {
  const provider = state.providers.find((row) => row.id === id) ?? null
  if (provider !== null && provider.provider_type === 'litert_lm' && provider.local_backend !== null) {
    const info = demoLocalModel(provider.base_url, provider.local_backend)
    return [
      {
        id: info.file_name,
        name: info.file_name,
        suggested_canonical_id: null,
        suggested_protocol: null,
        suggested_domain: 'chat',
      },
    ]
  }
  const configured = state.modelConfigs.filter((m) => m.provider_id === id).map((m) => m.model_id)
  const extra = id === 'demo-provider-anthropic' ? ['claude-opus-5', 'claude-sonnet-5-preview'] : []
  return [...configured, ...extra].map((model) => ({
    id: model,
    name: model,
    suggested_canonical_id: null,
    suggested_protocol: null,
    suggested_domain: 'chat',
  }))
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
      media: [],
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
  const profile: ModelProfileInfoResponse = {
    id: req.profile.id ?? mintId(backend.state, 'profile'),
    name: req.profile.name,
    canonical_id: existing?.profile.canonical_id ?? null,
    capability_domain: req.profile.capability_domain,
    family: existing?.profile.family ?? null,
    icon: existing?.profile.icon ?? null,
    routing_policy:
      existing?.profile.routing_policy ??
      (req.profile.capability_domain === 'image_gen' || req.profile.capability_domain === 'video_gen'
        ? 'auto_failover_stateless'
        : 'sticky_manual'),
    is_archived: false,
    context_window: req.profile.context_window,
    compact_threshold: req.profile.compact_threshold,
    max_output_tokens: req.profile.max_output_tokens,
    input_price: req.profile.input_price,
    output_price: req.profile.output_price,
    cache_read_price: req.profile.cache_read_price,
    cache_write_price: req.profile.cache_write_price,
    cache_write_1h_price: req.profile.cache_write_1h_price,
    cache_ttl: req.profile.cache_ttl,
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
    protocol_override: req.protocol_override,
    is_enabled: existing?.is_enabled ?? true,
    priority: existing?.priority ?? 100,
    capability_overrides: existing?.capability_overrides ?? null,
    overrides_pricing: req.overrides_pricing,
    input_price: req.input_price,
    output_price: req.output_price,
    cache_read_price: req.cache_read_price,
    cache_write_price: req.cache_write_price,
    cache_write_1h_price: req.cache_write_1h_price,
    pricing_tiers: req.pricing_tiers,
    server_tools: req.server_tools,
    server_tool_price: req.server_tool_price,
    effective_pricing: req.overrides_pricing
      ? {
          input_price: req.input_price,
          output_price: req.output_price,
          cache_read_price: req.cache_read_price,
          cache_write_price: req.cache_write_price,
          cache_write_1h_price: req.cache_write_1h_price,
          pricing_tiers: req.pricing_tiers,
          server_tool_price: req.server_tool_price,
        }
      : {
          input_price: profile.input_price,
          output_price: profile.output_price,
          cache_read_price: profile.cache_read_price,
          cache_write_price: profile.cache_write_price,
          cache_write_1h_price: profile.cache_write_1h_price,
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
    const req = request<ConversationListRequest>(args)
    return state.conversations.filter(
      (c) =>
        c.is_archived === req.archived &&
        c.parent_conversation_id === null &&
        (req.project_id === null || c.project_id === req.project_id),
    )
  },
  create_conversation: (args, backend) => {
    const req = request<ConversationCreateRequest>(args)
    const now = Date.now()
    const row = conversation({
      id: mintId(backend.state, 'conv'),
      title: req.title,
      project_id: req.project_id,
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
      subRuns: [],
      shellResults: {},
      contextContents: {},
      todo: null,
    }
    return row
  },
  update_conversation: (args, backend) => {
    const req = request<ConversationUpdateRequest>(args)
    const row = conversationOf(backend, req.id)
    patch(row, req)
    row.updated_at = Date.now()
    return row
  },
  delete_conversation: (args, { state }) => {
    const id = request<{ id: string }>(args).id
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
  get_conversation_snapshot: (args, { state }) =>
    snapshot(state, request<{ conversation_id: string }>(args).conversation_id),
  switch_message_branch: (args, { state }) => {
    const req = request<{ conversation_id: string; message_id: string }>(args)
    const thread = state.threads[req.conversation_id]
    thread.head = newestTip(thread, req.message_id)
    touchConversation(state, req.conversation_id, thread.head)
    return null
  },
  delete_message: (args, { state }) => {
    const req = request<{ conversation_id: string; id: string }>(args)
    const thread = state.threads[req.conversation_id]
    deleteSubtree(thread, req.id)
    touchConversation(state, req.conversation_id, thread.head)
    return null
  },
  update_message_rating: (args, { state }) => {
    const req = request<{ id: string; rating: -1 | 1 | null }>(args)
    for (const thread of Object.values(state.threads)) {
      const row = thread.all.find((m) => m.id === req.id)
      if (row) row.rating = req.rating
    }
    return null
  },
  read_message_context_item: (args, { state }) => {
    const req = request<{ conversation_id: string; item_id: string }>(args)
    const thread = state.threads[req.conversation_id]
    for (const row of thread?.all ?? []) {
      const descriptor = row.context_items.find((item) => item.id === req.item_id)
      if (descriptor) return { descriptor, content: thread.contextContents[req.item_id] ?? '' }
    }
    throw `context item not found: ${req.item_id}`
  },
  get_conversation_context: (args, { state }) => {
    const id = request<{ conversation_id: string }>(args).conversation_id
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
  get_todo_list: (args, { state }) =>
    state.threads[request<{ conversation_id: string }>(args).conversation_id]?.todo ?? null,
  invoke_conversation_compaction: (args, backend) => {
    const id = request<{ conversation_id: string }>(args).conversation_id
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
    const req = request<{ conversation_id: string; message_id: string }>(args)
    return state.threads[req.conversation_id]?.shellResults[req.message_id] ?? null
  },
  get_active_user_command: () => null,
}

const chat: Record<string, DemoHandler> = {
  start_chat: (args, backend) => {
    const req = request<ChatStartRequest>(args)
    const { state } = backend
    const thread = state.threads[req.conversation_id]
    if (!thread) throw `conversation not found: ${req.conversation_id}`
    if (isReplaying(state, req.conversation_id)) throw 'A turn is already running in this conversation.'
    const turnId = req.turn_id ?? mintId(state, 'turn')
    let parent = tailOf(backend, req.conversation_id)
    let content = req.message
    if (req.replaces) {
      const replaced = thread.all.find((m) => m.id === req.replaces)
      parent = replaced?.parent_id ?? null
      // Regenerating re-asks the question above; editing asks a new one.
      if (req.message === null && replaced?.role === 'user') content = replaced.content
    }
    const convo = conversationOf(backend, req.conversation_id)
    if (convo.title === null && content) {
      convo.title = content.slice(0, 24)
      backend.later(50, () => backend.emit('conversation-updated', { conversation_id: convo.id }))
    }
    startReplay(backend, req.conversation_id, turnId, parent, content)
    return null
  },
  stop_chat: (args, { state }) => {
    stopReplay(state, request<{ conversation_id: string }>(args).conversation_id)
    return null
  },
  send_conversation_steer: () => {
    throw 'Nothing is running to steer in demo mode.'
  },
  submit_approval_decision: (args, backend) => {
    const req = request<ApprovalDecisionRequest>(args)
    if (req.decision.kind === 'approve') {
      if (!answerReplay(backend.state, req.approval_id, true)) {
        settleFixtureApproval(backend, req.approval_id, '（演示）命令已执行，退出码 0。', false)
      }
    } else if (req.decision.kind === 'deny') {
      if (!answerReplay(backend.state, req.approval_id, false)) {
        settleFixtureApproval(
          backend,
          req.approval_id,
          `The user denied this tool call.${req.decision.reason ? ` ${req.decision.reason}` : ''}`,
          true,
        )
      }
    } else {
      settleFixtureApproval(backend, req.approval_id, req.decision.response, false)
    }
    return null
  },
  list_pending_approvals: (_args, backend) => allPending(backend),
  invoke_user_command: (args, backend) => {
    const req = request<UserCommandRunRequest>(args)
    const { state } = backend
    const thread = state.threads[req.conversation_id]
    const id = mintId(state, 'msg')
    const stdout = `（演示）${req.command}\n这条命令没有真的执行。\n`
    const itemId = mintId(state, 'ctx')
    thread.all.push(
      message({
        id,
        conversation_id: req.conversation_id,
        role: 'user',
        content: `!${req.command}`,
        source: 'shell',
        created_at: Date.now(),
        parent_id: tailOf(backend, req.conversation_id),
        sort_order: thread.all.length,
        turn_id: req.turn_id,
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
      conversation_id: req.conversation_id,
      turn_id: req.turn_id,
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
    touchConversation(state, req.conversation_id, id)
    return result
  },
  upload_message_file: (args) => {
    const path = request<{ file_path: string }>(args).file_path
    const name = path.split(/[\\/]/).pop() ?? path
    return { type: 'file', file: { url: `data:text/plain,${encodeURIComponent(name)}`, mime_type: 'text/plain', name } }
  },
  read_local_image_preview: () => ({
    mime_type: 'image/png',
    data_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  }),
  get_composer_draft: (args, { state }) =>
    state.drafts[request<ComposerDraftReadRequest>(args).conversation_id ?? ''] ?? null,
  set_composer_draft: (args, { state }) => {
    const req = request<ComposerDraftUpsertRequest>(args)
    const key = req.conversation_id ?? ''
    const current = state.drafts[key]
    if (current && current.revision >= req.revision) return { applied: false, revision: current.revision }
    state.drafts[key] = {
      conversation_id: req.conversation_id,
      body: req.body,
      attachments: req.attachments.map((a) => ({ ...a, exists: true })),
      conversation_refs: req.conversation_refs.map((id) => ({
        id,
        title: state.conversations.find((c) => c.id === id)?.title ?? null,
        exists: state.conversations.some((c) => c.id === id),
      })),
      revision: req.revision,
      updated_at: Date.now(),
    }
    return { applied: true, revision: req.revision }
  },
  delete_composer_draft: (args, { state }) => {
    const req = request<ComposerDraftDeleteRequest>(args)
    const key = req.conversation_id ?? ''
    const current = state.drafts[key]
    if (current && current.revision >= req.revision) return { applied: false, revision: current.revision }
    delete state.drafts[key]
    return { applied: true, revision: req.revision }
  },
  list_queued_prompts: (args, { state }) =>
    state.queues[request<{ conversation_id: string }>(args).conversation_id] ?? [],
  list_background_tasks: (args, { state }) =>
    state.backgroundTasks[request<BackgroundTaskListRequest>(args).conversation_id] ?? [],
  list_background_task_counts: (_args, { state }) =>
    Object.entries(state.backgroundTasks)
      .map(([conversation_id, tasks]) => ({
        conversation_id,
        running: tasks.filter((t) => t.state === 'running').length,
      }))
      .filter((row) => row.running > 0),
  stop_background_task: (args, backend) => {
    const req = request<BackgroundTaskStopRequest>(args)
    const task = (backend.state.backgroundTasks[req.conversation_id] ?? []).find((t) => t.id === req.id)
    if (!task) throw `there is no background task ${req.id} in this conversation`
    if (task.state === 'running') {
      task.state = 'stopped'
      task.ended_reason = 'stopped by the user'
      task.ended_at = Date.now()
      backend.later(0, () => backend.emit('background-tasks-updated', { conversation_id: req.conversation_id }))
    }
    return task
  },
  read_background_task_output: (args, { state }) => {
    const req = request<BackgroundTaskOutputReadRequest>(args)
    const task = (state.backgroundTasks[req.conversation_id] ?? []).find((t) => t.id === req.id)
    if (!task) throw `there is no background task ${req.id} in this conversation`
    const log = state.backgroundOutput[req.id] ?? ''
    const offset = Math.min(req.offset, log.length)
    return { task, offset, content: log.slice(offset), next_offset: log.length, total_bytes: log.length }
  },
  create_queued_prompt: (args, backend) => {
    const req = request<QueuedPromptCreateRequest>(args)
    const queue = (backend.state.queues[req.conversation_id] ??= [])
    const row = {
      id: mintId(backend.state, 'queue'),
      conversation_id: req.conversation_id,
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
    backend.later(0, () => backend.emit('queue-updated', { conversation_id: req.conversation_id, delivered: false }))
    return row
  },
  delete_queued_prompt: (args, backend) => {
    const req = request<{ conversation_id: string; id: string }>(args)
    backend.state.queues[req.conversation_id] = (backend.state.queues[req.conversation_id] ?? []).filter(
      (q) => q.id !== req.id,
    )
    backend.later(0, () => backend.emit('queue-updated', { conversation_id: req.conversation_id, delivered: false }))
    return null
  },
}

const plan: Record<string, DemoHandler> = {
  get_plan_review: (args, { state }) => {
    if (request<{ review_id: string }>(args).review_id !== PLAN_REVIEW_ID) throw 'plan review not found'
    return state.planReview
  },
  list_plan_revisions: (_args, { state }) => [state.planReview.submitted_revision],
  set_plan_review_draft: (args, { state }) => {
    const req = request<{ expected_generation: number; normalized_markdown: string; global_note: string | null }>(args)
    const draft = state.planReview.draft
    if (req.expected_generation !== draft.generation) throw 'The draft changed in another window.'
    draft.generation += 1
    draft.draft_normalized_markdown = req.normalized_markdown
    draft.global_note = req.global_note
    draft.updated_at = Date.now()
    return {
      review_id: PLAN_REVIEW_ID,
      generation: draft.generation,
      draft_sha256: draft.draft_sha256,
      updated_at: draft.updated_at,
    }
  },
  delete_plan_review_draft: (_args, { state }) => {
    const draft = state.planReview.draft
    draft.generation += 1
    draft.draft_normalized_markdown = draft.base_normalized_markdown
    draft.global_note = null
    return state.planReview
  },
  submit_plan_review_decision: (args, backend) => {
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
            lock_version: summary.lock_version,
          }),
        )
      }
    }
    return { review_id: PLAN_REVIEW_ID, state: status }
  },
}

// The agent board, in memory. The rules are the backend's: a card's column
// is set only by moving it or starting it, a started card is deleted with its
// conversation and only once its worktree is gone. No worktree is made — the
// path a card reports is where one would be.
function boardCard(state: DemoState, id: string): BoardTaskInfoResponse {
  const card = state.boardTasks.find((t) => t.id === id)
  if (!card) throw `board card \`${id}\` not found`
  return card
}

function renumber(stage: BoardStage, order: BoardTaskInfoResponse[]) {
  order.forEach((card, position) => {
    card.stage = stage
    card.position = position
  })
}

function columnOf(state: DemoState, stage: BoardStage, except: string): BoardTaskInfoResponse[] {
  return state.boardTasks.filter((t) => t.stage === stage && t.id !== except).sort((a, b) => a.position - b.position)
}

function moveCard(state: DemoState, card: BoardTaskInfoResponse, stage: BoardStage, index: number) {
  const order = columnOf(state, stage, card.id)
  order.splice(Math.min(index, order.length), 0, card)
  renumber(stage, order)
  card.updated_at = Date.now()
}

const board: Record<string, DemoHandler> = {
  list_board_tasks: (_args, { state }) =>
    [...state.boardTasks].sort((a, b) => a.stage.localeCompare(b.stage) || a.position - b.position),
  create_board_task: (args, { state }) => {
    const req = request<BoardTaskCreateRequest>(args)
    const title = req.title.trim()
    if (!title) throw 'a card needs a title'
    if (!state.projects.some((p) => p.id === req.project_id)) throw `project \`${req.project_id}\` not found`
    const now = Date.now()
    const card: BoardTaskInfoResponse = {
      id: mintId(state, 'card'),
      project_id: req.project_id,
      conversation_id: null,
      source: 'local',
      title: title.slice(0, 80),
      request: req.request,
      stage: req.stage,
      position: columnOf(state, req.stage, '').length,
      agent_kind: null,
      worktree_path: null,
      created_at: now,
      updated_at: now,
      worktree_removed_at: null,
    }
    state.boardTasks.push(card)
    return card
  },
  update_board_task: (args, { state }) => {
    const req = request<BoardTaskUpdateRequest>(args)
    const card = boardCard(state, req.id)
    if (req.title !== undefined) {
      const title = req.title.trim()
      if (!title) throw 'a card needs a title'
      card.title = title.slice(0, 80)
    }
    if (req.request !== undefined) card.request = req.request
    if (req.position !== undefined) moveCard(state, card, req.position.stage, req.position.index)
    card.updated_at = Date.now()
    return card
  },
  start_board_task: (args, backend) => {
    const req = request<BoardTaskStartRequest>(args)
    const { state } = backend
    const card = boardCard(state, req.id)
    if (card.conversation_id !== null || card.worktree_removed_at !== null) throw 'this card has already been started'
    const project = state.projects.find((p) => p.id === card.project_id)
    if (!project?.path) throw "the card's project has no folder; give the project one before starting a card"
    const conversation = conversations.create_conversation(
      { request: { title: card.title, project_id: card.project_id } },
      backend,
    ) as ConversationInfoResponse
    card.conversation_id = conversation.id
    card.agent_kind = req.agent_kind
    card.worktree_path = `${project.path}.worktrees/${card.id.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`
    moveCard(state, card, 'running', columnOf(state, 'running', card.id).length)
    return { task: card, conversation }
  },
  delete_board_task_worktree: (args, { state }) => {
    const card = boardCard(state, request<{ id: string }>(args).id)
    if (card.worktree_path === null) throw 'this card has no worktree'
    card.worktree_path = null
    card.worktree_removed_at = Date.now()
    moveCard(state, card, 'done', columnOf(state, 'done', card.id).length)
    return card
  },
  delete_board_task: (args, backend) => {
    const card = boardCard(backend.state, request<{ id: string }>(args).id)
    if (card.worktree_path !== null) throw "remove the card's worktree before deleting it"
    const conversationId = card.conversation_id
    if (conversationId !== null) conversations.delete_conversation({ request: { id: conversationId } }, backend)
    backend.state.boardTasks = backend.state.boardTasks.filter((t) => t.id !== card.id)
    backend.emit('board-updated', { task_id: null })
    if (conversationId !== null) backend.emit('conversation-updated', { conversation_id: conversationId })
    return null
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
      channel_kind: null,
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
    patch(row, req)
    row.updated_at = Date.now()
    return row
  },
  delete_project: (args, { state }) => {
    const id = request<{ id: string }>(args).id
    state.projects = state.projects.filter((p) => p.id !== id)
    for (const c of state.conversations) if (c.project_id === id) c.project_id = null
    return null
  },
  get_workspace_root: (args, { state }) => {
    const convo = state.conversations.find((c) => c.id === request<{ conversation_id: string }>(args).conversation_id)
    if (!convo?.project_id) return { state: 'no_project' }
    const project = state.projects.find((p) => p.id === convo.project_id)
    if (!project?.path) return { state: 'no_path' }
    return { state: 'ok', root: project.path, git_available: true, is_repo: convo.project_id === PROJECT_MERIDIAN }
  },
  list_workspace_entries: (args) => tree(request<{ dir: string | null }>(args).dir),
  read_workspace_file: (args) => {
    const rel = request<WorkspaceFileReadRequest>(args).rel_path
    const file = readFile(rel)
    if (!file) throw `No such file: ${rel}`
    return file
  },
  test_workspace_ref: (args) => {
    const path = request<WorkspaceReferenceProbeRequest>(args).path
    if (readFile(path)) return { kind: 'project_file', path }
    throw `not a workspace path: ${path}`
  },
  resolve_workspace_ref: (args) => {
    const req = request<WorkspaceReferenceResolveRequest>(args)
    const file = readFile(req.path)
    if (!file) throw `No such file: ${req.path}`
    return {
      kind: 'project_file',
      path: req.path,
      content: file.content,
      line_start: req.line_start,
      line_end: req.line_end,
      byte_count: file.size_bytes,
      line_count: file.total_lines,
      token_count: Math.ceil(file.size_bytes / 4),
      truncated: false,
    }
  },
  search_workspace_refs: (args) => {
    const query = request<WorkspaceReferenceSuggestRequest>(args).query.toLowerCase()
    return tree(null)
      .concat(tree('src/lib'), tree('src/components/chat'))
      .filter((entry) => entry.rel_path.toLowerCase().includes(query))
      .map((entry) => ({ path: entry.rel_path, name: entry.name, is_dir: entry.is_dir }))
  },
  // The same answers `get_workspace_root` gives: only the Meridian project is a
  // repository, and a conversation without a folder is refused, as
  // `require_root` refuses it.
  get_workspace_git_status: (args, { state }) => {
    const convo = state.conversations.find((c) => c.id === request<{ conversation_id: string }>(args).conversation_id)
    const project = convo?.project_id ? state.projects.find((p) => p.id === convo.project_id) : undefined
    if (!project) throw 'no_project'
    if (!project.path) throw 'no_path'
    return project.id === PROJECT_MERIDIAN ? GIT_STATUS : { state: 'not_repo' }
  },
  get_workspace_git_diff: (args) => ({
    diff_text: gitDiff(request<WorkspaceGitDiffRequest>(args).rel_path),
    truncated: false,
  }),
  open_workspace_editor: () => {
    throw 'Opening an editor is not available in the browser.'
  },
}

const providers: Record<string, DemoHandler> = {
  list_providers: (_args, { state }) => state.providers,
  test_local_model: (args) => {
    const req = request<LocalModelInspectRequest>(args)
    return demoLocalModel(req.model_path, req.backend)
  },
  get_provider_local_model: (args, { state }) => {
    const req = request<ProviderLocalModelReadRequest>(args)
    const provider = state.providers.find((row) => row.id === req.provider_id) ?? null
    if (provider === null || provider.provider_type !== 'litert_lm' || provider.local_backend === null)
      throw 'demo: provider is not a configured local model'
    return demoLocalModel(provider.base_url, provider.local_backend)
  },
  list_provider_catalog: () => buildCatalog(),
  get_codex_auth_status: () => ({
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
      provider_type: req.provider_type,
      base_url: req.base_url,
      is_enabled: true,
      sort_order: state.providers.length,
      created_at: now,
      updated_at: now,
      api_format: req.api_format ?? 'chat_completions',
      catalog_id: req.catalog_id,
      credential_kind: req.provider_type === 'litert_lm' ? 'none' : 'api_key',
      transport_profile: req.provider_type === 'litert_lm' ? 'local_native' : 'standard',
      icon: null,
      codex_request_shape: false,
      local_backend: req.local_backend,
      capability_domain: req.provider_type === 'media' ? 'image_gen' : 'chat',
      config_json: null,
    }
    state.providers.push(row)
    return row
  },
  update_provider: (args, { state }) => {
    const req = request<ProviderUpdateRequest>(args)
    const row = state.providers.find((p) => p.id === req.id)
    if (!row) throw 'provider not found'
    const previousType = row.provider_type
    patch(row, req)
    if (req.catalog_id === undefined && row.provider_type !== previousType) row.catalog_id = null
    row.updated_at = Date.now()
    return row
  },
  delete_provider: (args, { state }) => {
    const id = request<{ id: string }>(args).id
    state.providers = state.providers.filter((p) => p.id !== id)
    state.modelConfigs = state.modelConfigs.filter((m) => m.provider_id !== id)
    return null
  },
  set_provider_key: (args, { state }) => {
    state.providerKeys.add(request<{ provider_id: string }>(args).provider_id)
    return null
  },
  test_provider_key: (args, { state }) => state.providerKeys.has(request<{ provider_id: string }>(args).provider_id),
  list_provider_models: (args, { state }) =>
    demoProviderModels(state, request<ProviderModelListRequest>(args).provider_id),
  get_provider_capabilities: (args, { state }) => {
    const provider =
      state.providers.find((row) => row.id === request<{ provider_id: string }>(args).provider_id) ?? null
    if (provider === null) throw 'demo: provider not found'
    if (provider.provider_type !== 'litert_lm') return CAPABILITIES
    if (provider.local_backend === null) throw 'demo: missing local backend'
    const info = demoLocalModel(provider.base_url, provider.local_backend)
    return {
      ...CAPABILITIES,
      supports_tools: info.supports_function_calling,
      supports_streaming_tools: info.supports_function_calling,
      supports_thinking: info.supports_thinking,
      readable_mime_types: [],
      supports_temperature: false,
      supports_top_p: false,
      max_temperature: null,
      max_context_tokens: null,
      max_output_tokens: null,
      server_tools: [],
    }
  },
  get_provider_balance: (args) =>
    request<{ provider_id: string }>(args).provider_id === 'demo-provider-deepseek'
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
    state.modelConfigs.filter((m) => m.provider_id === request<{ provider_id: string }>(args).provider_id),
  list_model_profiles: (_args, { state }) => state.modelConfigs.map((m) => m.profile),
  get_model_config: (args, { state }) => {
    const req = request<{ provider_id: string; model_id: string }>(args)
    return state.modelConfigs.find((m) => m.provider_id === req.provider_id && m.model_id === req.model_id) ?? null
  },
  set_model_config: (args, backend) => modelConfigFrom(backend, request<ModelConfigUpsertRequest>(args)),
  delete_model_config: (args, { state }) => {
    const id = request<{ id: string }>(args).id
    state.modelConfigs = state.modelConfigs.filter((m) => m.id !== id)
    return null
  },
  list_logical_models: (_args, { state }) => {
    const byProfile = new Map<string, LogicalModelInfoResponse>()
    for (const cfg of state.modelConfigs) {
      const provider = state.providers.find((p) => p.id === cfg.provider_id)
      const existing = byProfile.get(cfg.profile.id) ?? { profile: cfg.profile, deployments: [] }
      existing.deployments.push({
        id: cfg.id,
        provider_id: cfg.provider_id,
        provider_name: provider?.name ?? 'Unknown Provider',
        provider_icon: provider?.icon ?? null,
        provider_catalog_id: provider?.catalog_id ?? null,
        provider_enabled: provider?.is_enabled ?? false,
        model_id: cfg.model_id,
        profile_id: cfg.profile.id,
        effective_protocol:
          cfg.protocol_override ?? (provider?.provider_type === 'anthropic' ? 'anthropic_messages' : 'openai_chat'),
        protocol_override: cfg.protocol_override,
        compliance: { status: 'standard' },
        is_enabled: cfg.is_enabled,
        priority: cfg.priority,
        overrides_pricing: cfg.overrides_pricing,
        effective_pricing: cfg.effective_pricing,
        capability_overrides: cfg.capability_overrides,
        created_at: cfg.created_at,
        updated_at: cfg.updated_at,
      })
      byProfile.set(cfg.profile.id, existing)
    }
    return [...byProfile.values()]
  },
  create_logical_model: (args, { state }) => {
    const req = request<LogicalModelCreateRequest>(args)
    const now = Date.now()
    const created: ModelProfileInfoResponse = {
      id: mintId(state, 'profile'),
      name: req.name,
      canonical_id: req.canonical_id,
      capability_domain: req.capability_domain,
      family: req.family,
      icon: req.icon,
      routing_policy: req.routing_policy,
      is_archived: false,
      context_window: req.context_window,
      compact_threshold: req.compact_threshold,
      max_output_tokens: req.max_output_tokens,
      input_price: req.input_price,
      output_price: req.output_price,
      cache_read_price: req.cache_read_price,
      cache_write_price: req.cache_write_price,
      cache_write_1h_price: req.cache_write_1h_price,
      cache_ttl: req.cache_ttl,
      pricing_tiers: req.pricing_tiers,
      capability_overrides: req.capability_overrides,
      model_count: 0,
      created_at: now,
      updated_at: now,
    }
    return created
  },
  update_logical_model: (args, { state }) => {
    const req = request<LogicalModelUpdateRequest>(args)
    const match = state.modelConfigs.find((m) => m.profile.id === req.id)
    if (!match) throw 'logical model not found'
    patch(match.profile, req)
    match.profile.updated_at = Date.now()
    return match.profile
  },
  delete_logical_model: (args, { state }) => {
    const req = request<LogicalModelDeleteRequest>(args)
    if (req.cascade_deployments) {
      state.modelConfigs = state.modelConfigs.filter((m) => m.profile.id !== req.id)
    }
    return null
  },
  attach_model_deployment: (args, backend) => {
    const req = request<ModelDeploymentAttachRequest>(args)
    const now = Date.now()
    const profile: ModelProfileInfoResponse = (req.profile_id
      ? backend.state.modelConfigs.find((m) => m.profile.id === req.profile_id)?.profile
      : undefined) ?? {
      id: req.profile_id ?? mintId(backend.state, 'profile'),
      name: req.display_name ?? req.model_id,
      canonical_id: null,
      capability_domain: 'chat',
      family: null,
      icon: null,
      routing_policy: 'sticky_manual',
      is_archived: false,
      context_window: 128_000,
      compact_threshold: 100_000,
      max_output_tokens: null,
      input_price: null,
      output_price: null,
      cache_read_price: null,
      cache_write_price: null,
      cache_write_1h_price: null,
      cache_ttl: null,
      pricing_tiers: [],
      capability_overrides: null,
      model_count: 1,
      created_at: now,
      updated_at: now,
    }
    const row: ModelConfigInfoResponse = {
      id: mintId(backend.state, 'model'),
      provider_id: req.provider_id,
      model_id: req.model_id,
      profile,
      protocol_override: req.protocol_override,
      is_enabled: true,
      priority: req.priority ?? 100,
      capability_overrides: null,
      overrides_pricing: false,
      input_price: null,
      output_price: null,
      cache_read_price: null,
      cache_write_price: null,
      cache_write_1h_price: null,
      pricing_tiers: [],
      server_tools: null,
      server_tool_price: null,
      effective_pricing: {
        input_price: profile.input_price,
        output_price: profile.output_price,
        cache_read_price: profile.cache_read_price,
        cache_write_price: profile.cache_write_price,
        cache_write_1h_price: profile.cache_write_1h_price,
        pricing_tiers: profile.pricing_tiers,
        server_tool_price: null,
      },
      created_at: now,
      updated_at: now,
    }
    backend.state.modelConfigs.push(row)
    return row
  },
  update_model_deployment: (args, { state }) => {
    const req = request<ModelDeploymentUpdateRequest>(args)
    const row = state.modelConfigs.find((m) => m.id === req.id)
    if (!row) throw 'model deployment not found'
    patch(row, req)
    row.updated_at = Date.now()
    return row
  },
  switch_model_deployment_profile: (args, { state }) => {
    const req = request<ModelDeploymentProfileSwitchRequest>(args)
    const row = state.modelConfigs.find((m) => m.id === req.deployment_id)
    if (!row) throw 'model deployment not found'
    if (req.target_profile_id) {
      const target = state.modelConfigs.find((m) => m.profile.id === req.target_profile_id)?.profile
      if (target) row.profile = target
    } else {
      row.profile = {
        ...row.profile,
        id: mintId(state, 'profile'),
        name: req.new_profile_name ?? row.model_id,
        canonical_id: null,
        model_count: 1,
        updated_at: Date.now(),
      }
    }
    row.updated_at = Date.now()
    return row
  },
  delete_model_deployment: (args, { state }) => {
    const id = request<ModelDeploymentDeleteRequest>(args).id
    state.modelConfigs = state.modelConfigs.filter((m) => m.id !== id)
    return null
  },
  get_usage_report: (args, { state }) =>
    usageBuckets(request<{ dimension: UsageDimension }>(args).dimension, state.now),
  // The fixture's total has nothing unpriced or incomplete, so its list is empty.
  list_usage_gaps: () => ({ total: 0, items: [] }),
  get_usage_cache_misses: () => usageCacheMisses(),
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
      system_prompt: req.system_prompt,
      model_id: req.model_id,
      temperature: req.temperature,
      top_p: req.top_p,
      max_tokens: req.max_tokens,
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
    patch(row, req)
    row.updated_at = Date.now()
    return row
  },
  delete_assistant: (args, { state }) => {
    const id = request<{ id: string }>(args).id
    state.assistants = state.assistants.filter((a) => a.id !== id)
    return null
  },
  list_tool_categories: (_args, { state }) => buildToolCategories(state.now),
  list_custom_tools: (_args, { state }) => state.customTools,
  create_custom_tool: (args, { state }) => {
    const r = request<CustomToolCreateRequest>(args)
    const execution = r.execution === null ? null : parseCustomToolExecution(r.execution)
    if (execution && r.timeout_ms !== null && (!Number.isInteger(r.timeout_ms) || r.timeout_ms <= 0)) {
      throw new Error('Custom tool timeout must be positive')
    }
    const now = Date.now()
    const row: CustomToolInfoResponse = {
      id: mintId(state, 'custom-tool'),
      name: r.name,
      description: r.description,
      command: r.command,
      args_template: r.args_template,
      execution,
      category_id: r.category_id,
      parameters_schema: r.parameters_schema ?? { type: 'object', properties: {} },
      working_directory: r.working_directory,
      timeout_ms: r.timeout_ms,
      permission: r.permission ?? 'ask',
      is_enabled: execution !== null,
      sort_order: 0,
      created_at: now,
      updated_at: now,
    }
    state.customTools.push(row)
    return row
  },
  update_custom_tool: (args, { state }) => {
    const r = request<CustomToolUpdateRequest>(args)
    const index = state.customTools.findIndex((row) => row.id === r.id)
    if (index < 0) throw new Error('Custom tool not found')
    const row = { ...state.customTools[index] }
    const execution =
      r.execution === undefined ? row.execution : r.execution === null ? null : parseCustomToolExecution(r.execution)
    const enabled = r.is_enabled ?? row.is_enabled
    const timeout = r.timeout_ms === undefined ? row.timeout_ms : r.timeout_ms
    if (enabled && execution === null)
      throw new Error('Legacy custom tools cannot be enabled without a safe execution definition')
    if (execution && timeout !== null && (!Number.isInteger(timeout) || timeout <= 0))
      throw new Error('Custom tool timeout must be positive')
    patch(row, r)
    row.execution = execution
    row.updated_at = Date.now()
    state.customTools[index] = row
    return row
  },
  delete_custom_tool: (args, { state }) => {
    const id = request<{ id: string }>(args).id
    state.customTools = state.customTools.filter((t) => t.id !== id)
    return null
  },
  list_tool_presets: (_args, { state }) => state.toolPresets,
  delete_tool_preset: (args, { state }) => {
    const id = request<{ id: string }>(args).id
    state.toolPresets = state.toolPresets.filter((t) => t.id !== id)
    return null
  },
  list_tools: () => buildToolNames(),
  list_skills: (_args, { state }) => state.skills,
  invoke_skill_rescan: (_args, { state }) => state.skills,
  read_skill_body: () => SKILL_BODY,
  update_skill: (args, { state }) => {
    const req = request<SkillUpdateRequest>(args)
    const row = state.skills.find((s) => s.dir_name === req.dir_name)
    if (!row) throw 'skill not found'
    const { dir_name: _dir, ...rest } = req
    patch(row, rest)
    return row
  },
  list_skill_bindings: (args, { state }) => {
    const req = request<SkillBindingListRequest>(args)
    return state.skillBindings[`${req.layer}:${req.anchor_id ?? ''}`] ?? []
  },
  set_skill_binding: (args, { state }) => {
    const req = request<SkillBindingUpdateRequest>(args)
    const key = `${req.layer}:${req.anchor_id ?? ''}`
    const names = new Set(state.skillBindings[key] ?? [])
    if (req.bound) names.add(req.dir_name)
    else names.delete(req.dir_name)
    state.skillBindings[key] = [...names]
    return state.skillBindings[key]
  },
}

const mcp: Record<string, DemoHandler> = {
  list_mcp_servers: (_args, { state }) => state.mcpServers,
  create_mcp_server: (args, { state }) => {
    const req = request<McpServerCreateRequest>(args)
    const now = Date.now()
    const row = {
      id: mintId(state, 'mcp'),
      name: req.name,
      transport_type: req.transport_type,
      command: req.command,
      args: req.args,
      env: req.env,
      url: req.url,
      headers: req.headers,
      is_enabled: true,
      default_policy: null,
      tool_policies: null,
      approved_always_tools: null,
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
    patch(row, req)
    row.updated_at = Date.now()
    return row
  },
  delete_mcp_server: (args, { state }) => {
    const id = request<{ id: string }>(args).id
    state.mcpServers = state.mcpServers.filter((s) => s.id !== id)
    state.mcpConnected.delete(id)
    return null
  },
  connect_mcp_server: (args, { state }) => {
    state.mcpConnected.add(request<{ id: string }>(args).id)
    return null
  },
  disconnect_mcp_server: (args, { state }) => {
    state.mcpConnected.delete(request<{ id: string }>(args).id)
    return null
  },
  list_mcp_tools: (args, { state }) => {
    const serverId = request<McpToolListRequest>(args).server_id
    return buildMcpTools()
      .filter(
        (t) =>
          state.mcpConnected.has(t.server_id) &&
          (serverId === null || serverId === undefined || t.server_id === serverId),
      )
      .map((t) => ({
        ...t,
        enabled: !(state.mcpDisabledTools[t.server_id] ?? []).includes(t.name),
      }))
  },
  set_mcp_tool_enabled: (args, { state }) => {
    const req = request<McpToolEnabledUpdateRequest>(args)
    const row = state.mcpServers.find((s) => s.id === req.server_id)
    if (!row) throw 'server not found'
    const current = new Set(state.mcpDisabledTools[req.server_id] ?? [])
    if (req.enabled) current.delete(req.tool_name)
    else current.add(req.tool_name)
    state.mcpDisabledTools[req.server_id] = [...current]
    row.updated_at = Date.now()
    return row
  },
  get_mcp_default_policy: (_args, { state }) => state.mcpDefaultPolicy,
  set_mcp_default_policy: (args, { state }) => {
    const req = request<McpDefaultPolicyUpdateRequest>(args)
    state.mcpDefaultPolicy = { scope: req.scope, loading: req.loading, approval: req.approval }
    return state.mcpDefaultPolicy
  },
  set_mcp_server_policy: (args, { state }) => {
    const req = request<McpServerPolicyUpdateRequest>(args)
    const row = state.mcpServers.find((s) => s.id === req.server_id)
    if (!row) throw 'server not found'
    const empty = req.scope === null && req.loading === null && req.approval === null
    row.default_policy = empty ? null : { scope: req.scope, loading: req.loading, approval: req.approval }
    if (req.approval === 'always') {
      const names = buildMcpTools()
        .filter((t) => t.server_id === row.id)
        .map((t) => t.name)
      row.approved_always_tools = [...new Set([...(row.approved_always_tools ?? []), ...names])].sort()
    }
    row.updated_at = Date.now()
    return row
  },
  set_mcp_tool_policy: (args, { state }) => {
    const req = request<McpToolPolicyUpdateRequest>(args)
    const row = state.mcpServers.find((s) => s.id === req.server_id)
    if (!row) throw 'server not found'
    const map = { ...(row.tool_policies ?? {}) }
    const empty = req.scope === null && req.loading === null && req.approval === null
    if (empty) delete map[req.tool_name]
    else map[req.tool_name] = { scope: req.scope, loading: req.loading, approval: req.approval }
    row.tool_policies = Object.keys(map).length > 0 ? map : null
    row.updated_at = Date.now()
    return row
  },
  set_mcp_approved_always_tools: (args, { state }) => {
    const req = request<McpServerApproveAlwaysToolsRequest>(args)
    const row = state.mcpServers.find((s) => s.id === req.server_id)
    if (!row) throw 'server not found'
    row.approved_always_tools = [...new Set([...(row.approved_always_tools ?? []), ...req.tool_names])].sort()
    row.updated_at = Date.now()
    return row
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
  list_memories: (args, { state }) => {
    const req = request<MemoryListRequest>(args)
    if (req.filter.kind === 'all') return state.memories
    if (req.filter.kind === 'project') {
      const projectId = req.filter.project_id
      return state.memories.filter((m) => m.scope_type === 'project' && m.scope_id === projectId)
    }
    return req.filter.limit !== null ? state.memoryTrash.slice(0, req.filter.limit) : state.memoryTrash
  },
  list_memory_subjects: (_args, { state }) => state.memorySubjects,
  get_memory_enums: () => ({
    scopes: ['project', 'client_global', 'channel_global', 'external_subject'],
    origins: ['private', 'group', 'admin', 'desktop', 'legacy'],
    visibilities: ['normal', 'owner_only'],
    memory_types: ['general', 'preference', 'fact', 'instruction', 'relationship'],
  }),
  create_memory: (args, { state }) => {
    const req = request<MemoryCreateRequest>(args)
    const now = Date.now()
    const row: MemoryInfoResponse = {
      id: mintId(state, 'memory'),
      scope_type: req.scope,
      scope_id:
        req.scope === 'project'
          ? (req.project_id ?? '')
          : req.scope === 'external_subject'
            ? (req.subject_scope_id ?? '')
            : req.scope === 'client_global'
              ? 'client'
              : 'channel',
      key: req.key,
      content: req.content,
      memory_type: req.memory_type ?? 'general',
      subject_scope_id: req.subject_scope_id,
      origin: 'desktop',
      visibility: req.owner_only ? 'owner_only' : 'normal',
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
    const req = request<MemoryUpdateRequest>(args)
    const row = state.memories.find((m) => m.id === req.id)
    if (!row) throw 'memory not found'
    if (req.content !== undefined) row.content = req.content
    if (req.memory_type !== undefined) row.memory_type = req.memory_type
    if (req.owner_only !== undefined) row.visibility = req.owner_only ? 'owner_only' : 'normal'
    row.updated_at = Date.now()
    return row
  },
  delete_memories: (args, { state }) => {
    const req = request<MemoryDeleteRequest>(args)
    const ids = new Set(req.ids)
    if (req.permanent) {
      const before = state.memories.length + state.memoryTrash.length
      state.memories = state.memories.filter((m) => !ids.has(m.id))
      state.memoryTrash = state.memoryTrash.filter((m) => !ids.has(m.id))
      return before - (state.memories.length + state.memoryTrash.length)
    }
    const gone = state.memories.filter((m) => ids.has(m.id))
    state.memories = state.memories.filter((m) => !ids.has(m.id))
    state.memoryTrash.unshift(...gone.map((m) => ({ ...m, deleted_at: Date.now(), deleted_by: 'self' as const })))
    return gone.length
  },
  restore_memories: (args, { state }) => {
    const ids = new Set(request<MemoryRestoreRequest>(args).ids)
    const back = state.memoryTrash.filter((m) => ids.has(m.id))
    state.memoryTrash = state.memoryTrash.filter((m) => !ids.has(m.id))
    state.memories.unshift(...back.map((m) => ({ ...m, deleted_at: null, deleted_by: null })))
    return back.length
  },
  delete_memory_subject: (args, { state }) => {
    const id = request<MemorySubjectDeleteRequest>(args).subject_scope_id
    const before = state.memories.length
    state.memories = state.memories.filter((m) => m.subject_scope_id !== id)
    state.memorySubjects = state.memorySubjects.filter((s) => s.scope_id !== id)
    return before - state.memories.length
  },
  update_memory_subject: (args, { state }) => {
    const req = request<MemorySubjectUpdateRequest>(args)
    const row = state.memorySubjects.find((s) => s.scope_id === req.subject_scope_id)
    if (row && req.is_pinned !== null) row.is_pinned = req.is_pinned
    if (row && req.opted_out !== null) row.opted_out = req.opted_out
    return null
  },
  get_dream_config: (_args, { state }) => state.dreamConfig,
  set_dream_config: (args, { state }) => {
    const req = request<DreamConfigUpdateRequest>(args)
    state.dreamConfig = {
      enabled: req.enabled,
      model: req.model,
      cooldown_hours: req.cooldown_hours,
      min_turns: req.min_turns,
      daily_budget_usd: req.daily_budget_usd,
    }
    return state.dreamConfig
  },
  list_dream_runs: (args, { state }) => {
    const req = request<DreamRunListRequest>(args)
    let items = state.dreamRuns
    if (req.scope !== null) {
      items = items.filter((r) => r.scope_type === req.scope && (req.scope_id === null || r.scope_id === req.scope_id))
    }
    return req.limit !== null ? items.slice(0, req.limit) : items
  },
  start_dream_run: (args, { state }) => {
    const req = request<DreamRunStartRequest>(args)
    const now = Date.now()
    const run: DreamRunInfoResponse = {
      id: mintId(state, 'dream'),
      scope_type: req.scope,
      scope_id: req.scope_id,
      status: 'skipped',
      trigger: 'manual',
      model_id: state.dreamConfig.model?.model_id ?? 'claude-haiku-5',
      started_at: now,
      finished_at: now,
      turns_reviewed: 0,
      memories_created: 0,
      memories_updated: 0,
      memories_pruned: 0,
      proposals_created: 0,
      pruned_memory_ids: [],
      summary: 'No new conversation signal since the last consolidation.',
      error: null,
    }
    state.dreamRuns.unshift(run)
    return run
  },
  restore_dream_run: (args, { state }) => {
    const req = request<DreamRunRestoreRequest>(args)
    const run = state.dreamRuns.find((r) => r.id === req.run_id)
    if (!run) throw 'dream run not found'
    const ids = new Set(run.pruned_memory_ids)
    const restored = state.memoryTrash.filter((m) => ids.has(m.id))
    state.memoryTrash = state.memoryTrash.filter((m) => !ids.has(m.id))
    state.memories.unshift(...restored.map((m) => ({ ...m, deleted_at: null, deleted_by: null })))
    return { run_id: req.run_id, restored_count: restored.length }
  },
}

const system: Record<string, DemoHandler> = {
  get_platform: () => 'windows',
  list_system_fonts: () => [
    'Cascadia Code',
    'Consolas',
    'Microsoft YaHei UI',
    'PingFang SC',
    'Sarasa Gothic',
    'Segoe UI',
  ],
  get_window_insets: () => ({ top: 0, right: 0, bottom: 0, left: 0, ime_bottom: 0 }),
  get_app_info: () => APP_INFO,
  get_secret: () => null,
  get_preference: (args, { state }) => {
    const key = request<{ key: PreferenceKey }>(args).key
    return { key, value: state.preferences[key] }
  },
  set_preference: (args, { state }) => {
    const req = request<{ key: PreferenceKey; value: unknown }>(args)
    ;(state.preferences as Rec)[req.key] = req.value
    return null
  },
  test_service_key: (args, { state }) => state.serviceKeys.has(request<{ service: string }>(args).service),
  set_service_key: (args, { state }) => {
    state.serviceKeys.add(request<{ service: string }>(args).service)
    return null
  },
  read_logs: (args, { state }) => {
    const req = request<{ min_level: string | null; contains: string | null }>(args)
    const rank = { debug: 0, info: 1, warn: 2, error: 3 } as Record<string, number>
    const floor = rank[req.min_level ?? 'debug'] ?? 0
    const needle = req.contains?.toLowerCase() ?? ''
    return {
      entries: state.logs.filter(
        (e) => rank[e.level.toLowerCase()] >= floor && (!needle || e.msg.toLowerCase().includes(needle)),
      ),
      next_cursor: null,
      scan_truncated: false,
      files_scanned: ['meridian.log'],
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
    max_file_bytes: 5_242_880,
    max_files: 5,
    available: true,
  }),
  set_log_level: (args, { state }) => {
    state.logLevel = request<{ level: typeof state.logLevel }>(args).level
    return null
  },
  export_logs: () => ({ bytes_written: 6_447_280 }),
}

const integrations: Record<string, DemoHandler> = {
  get_voice_model_status: () => ({
    installed: true,
    path: 'C:\\Users\\demo\\AppData\\Roaming\\Meridian\\models\\sense-voice',
    size_bytes: 239_000_000,
    downloading: false,
  }),
  get_hooks_config: (_args, { state }) => state.hooks,
  set_hooks_config: (args, { state }) => {
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
  get_remote_config: (_args, { state }) => state.remote,
  set_remote_config: (args, { state }) => {
    const req = request<RemoteConfigUpdateRequest>(args)
    patch(state.remote, req)
    return state.remote
  },
  get_remote_status: (_args, { state }) => ({
    enabled: state.remote.enabled,
    running: state.remoteRunning,
    host: state.remote.host,
    port: state.remote.port,
    connections: 0,
  }),
  start_remote: (_args, { state }) => {
    state.remoteRunning = true
    return {
      enabled: state.remote.enabled,
      running: state.remoteRunning,
      host: state.remote.host,
      port: state.remote.port,
      connections: 0,
    }
  },
  stop_remote: (_args, { state }) => {
    state.remoteRunning = false
    return {
      enabled: state.remote.enabled,
      running: state.remoteRunning,
      host: state.remote.host,
      port: state.remote.port,
      connections: 0,
    }
  },
  reset_remote_token: (_args, { state }) => {
    state.remote.token = 'demo-listen-token-reset0'
    return state.remote
  },
  list_remote_addresses: () => ['192.168.1.20', '100.64.0.7'],
  get_ime_status: () => IME_STATUS,
  get_ime_config: (_args, { state }) => state.ime,
  set_ime_config: (args, { state }) => {
    state.ime = { ...request<typeof state.ime>(args) }
    return state.ime
  },
  list_ime_dictionaries: (_args, { state }) => state.imeDictionaries,
  // The demo machine did nothing on its own, so the inbox has no system tab.
  list_system_notices: () => [],
  // A browser has typed nothing into the demo's keyboard.
  get_ime_learning: () => ({ words: [], transitions: 0, pending: 0 }),
  delete_ime_learning: () => ({ words: [], transitions: 0, pending: 0 }),
  export_ime_learning: () => ({ path: '/tmp/meridian-ime-learn.zip' }),
  import_ime_learning: () => ({ words: [], transitions: 0, pending: 1 }),
  // A browser is launched by nobody's keyboard.
  take_launch_request: () => null,
  cancel_ime_dictionary_staging: () => null,
  delete_system_notice: () => null,
  set_ime_dictionary_enabled: (args, { state }) => {
    const req = request<{ file: string; enabled: boolean }>(args)
    const row = state.imeDictionaries.find((d) => d.file === req.file)
    if (row) row.enabled = req.enabled
    return state.imeDictionaries
  },
  get_ime_lm_status: () => IME_LM_STATUS,
  invoke_ime_memory_hints_refresh: () => ({
    count: 12,
    path: `${IME_STATUS.data_dir}\\context\\memory-hints.json`,
  }),
  get_acp_config: () => ({ command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@0.84.0'] }),
}

const media: Record<string, DemoHandler> = {
  create_media_generation: (args, { state }) => {
    const req = request<MediaGenerationCreateRequest>(args)
    const now = Date.now()
    const id = mintId(state, 'media')
    const record: MediaGenerationInfoResponse = {
      id,
      capability_domain: req.capability_domain,
      logical_model_id: req.logical_model_id,
      deployment_id: null,
      provider_id: null,
      remote_model_id: req.capability_domain === 'image_gen' ? 'gpt-image-1' : 'veo-3.1-generate-preview',
      protocol_id: req.capability_domain === 'image_gen' ? 'openai_images' : 'google_veo',
      prompt: req.prompt,
      params_json: JSON.stringify({
        aspect_ratio: req.aspect_ratio,
        size: req.size,
        quality: req.quality,
        count: req.count,
        resolution: req.resolution,
        duration_seconds: req.duration_seconds,
        seed: req.seed,
        generate_audio: req.generate_audio,
      }),
      status: 'succeeded',
      progress_pct: 100,
      upstream_job_id: null,
      assets: [
        {
          file_uri: `file:///demo/media_generations/${id}/00.${req.capability_domain === 'image_gen' ? 'png' : 'mp4'}`,
          relative_path: `${id}/00.${req.capability_domain === 'image_gen' ? 'png' : 'mp4'}`,
          mime_type: req.capability_domain === 'image_gen' ? 'image/png' : 'video/mp4',
          bytes_len: 128,
          width: 1024,
          height: 1024,
          duration_seconds: req.capability_domain === 'video_gen' ? (req.duration_seconds ?? 5) : null,
          revised_prompt: null,
          produce_id: `produce-${id}`,
          is_ai_generated: true,
          watermark_snapshot: null,
        },
      ],
      error_message: null,
      conversation_id: req.conversation_id,
      source: 'studio',
      created_at: now,
      updated_at: now,
      completed_at: now,
    }
    state.mediaGenerations.unshift(record)
    return record
  },
  list_media_generations: (args, { state }) => {
    const req = request<MediaGenerationListRequest>(args)
    const filtered =
      req.capability_domain === null
        ? state.mediaGenerations
        : state.mediaGenerations.filter((item) => item.capability_domain === req.capability_domain)
    const offset = req.offset === null ? 0 : req.offset
    return req.limit === null ? filtered.slice(offset) : filtered.slice(offset, offset + req.limit)
  },
  get_media_generation: (args, { state }) => {
    const req = request<MediaGenerationReadRequest>(args)
    return state.mediaGenerations.find((item) => item.id === req.id) ?? null
  },
  cancel_media_generation: (args, { state }) => {
    const req = request<MediaGenerationCancelRequest>(args)
    const row = state.mediaGenerations.find((item) => item.id === req.id)
    if (!row) return false
    row.status = 'cancelled'
    row.updated_at = Date.now()
    return true
  },
  delete_media_generation: (args, { state }) => {
    const req = request<MediaGenerationDeleteRequest>(args)
    const before = state.mediaGenerations.length
    state.mediaGenerations = state.mediaGenerations.filter((item) => item.id !== req.id)
    return state.mediaGenerations.length < before
  },
  export_media_generation: (args, { state }) => {
    const req = request<MediaGenerationExportRequest>(args)
    const row = state.mediaGenerations.find((item) => item.id === req.id)
    if (!row) throw `media generation not found: ${req.id}`
    const asset = row.assets[req.asset_index]
    if (!asset) throw `asset index ${req.asset_index} out of range`
    return {
      generation_id: row.id,
      asset_index: req.asset_index,
      mime_type: asset.mime_type,
      bytes_len: asset.bytes_len,
      produce_id: asset.produce_id,
      written_path: req.destination_path,
      base64_data: req.destination_path ? null : 'AAAA',
    }
  },
}

export const DEMO_HANDLERS: Record<string, DemoHandler> = {
  ...conversations,
  ...chat,
  ...plan,
  ...projects,
  ...board,
  ...providers,
  ...assistants,
  ...mcp,
  ...media,
  ...memories,
  ...system,
  ...integrations,
}
