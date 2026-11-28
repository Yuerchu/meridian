import { decimal } from '@/lib/decimal'
import type {
  BackgroundTaskInfoResponse,
  BoardTaskInfoResponse,
  AssistantInfoResponse,
  ComposerDraftInfoResponse,
  ConversationInfoResponse,
  CustomToolInfoResponse,
  DreamConfigInfoResponse,
  DreamRunInfoResponse,
  HookConfigInfoResponse,
  ImeConfigInfoResponse,
  ImeDictionaryInfoResponse,
  LogEntryInfoResponse,
  LogLevel,
  McpDefaultPolicyInfoResponse,
  McpServerInfoResponse,
  MediaGenerationInfoResponse,
  MemoryInfoResponse,
  MemorySubjectInfoResponse,
  ModelConfigInfoResponse,
  PlanReviewInfoResponse,
  PreferenceInfoValueByKey,
  ProjectInfoResponse,
  ProviderInfoResponse,
  QueuedPromptInfoResponse,
  RemoteConfigInfoResponse,
  SkillInfoResponse,
  ToolPresetInfoResponse,
} from '@/types'
import {
  CONV,
  PLAN_DOCUMENT_ID,
  PLAN_MARKDOWN,
  PLAN_REVIEW_ID,
  PLAN_REVISION_ID,
  PROJECT_MERIDIAN,
  buildConversations,
  buildProjects,
  buildThreads,
  type DemoThread,
} from './conversations'
import { ago } from './factories'
import {
  IME_CONFIG,
  IME_DICTIONARIES,
  buildAssistants,
  buildCustomTools,
  buildHooksConfig,
  buildRemoteConfig,
  buildLogs,
  buildMcpServers,
  buildMemories,
  buildMemorySubjects,
  buildMemoryTrash,
  buildModelConfigs,
  buildPreferences,
  buildProviders,
  buildSkills,
  buildToolPresets,
} from './settings'

/**
 * The whole in-memory backend. Built once per page load: writes persist for the
 * session and a reload starts over, which is what a fixture is for.
 */
export interface DemoState {
  now: number
  projects: ProjectInfoResponse[]
  /** The agent board's cards. */
  boardTasks: BoardTaskInfoResponse[]
  conversations: ConversationInfoResponse[]
  threads: Record<string, DemoThread>
  queues: Record<string, QueuedPromptInfoResponse[]>
  /** Background commands by conversation, and each one's log by task id. */
  backgroundTasks: Record<string, BackgroundTaskInfoResponse[]>
  backgroundOutput: Record<string, string>
  /** Keyed by conversation id, `''` for the welcome composer. */
  drafts: Record<string, ComposerDraftInfoResponse>
  providers: ProviderInfoResponse[]
  providerKeys: Set<string>
  modelConfigs: ModelConfigInfoResponse[]
  mediaGenerations: MediaGenerationInfoResponse[]
  assistants: AssistantInfoResponse[]
  mcpServers: McpServerInfoResponse[]
  mcpDefaultPolicy: McpDefaultPolicyInfoResponse
  mcpConnected: Set<string>
  /** Server id → tool names the model is not offered. */
  mcpDisabledTools: Record<string, string[]>
  customTools: CustomToolInfoResponse[]
  toolPresets: ToolPresetInfoResponse[]
  skills: SkillInfoResponse[]
  skillBindings: Record<string, string[]>
  memories: MemoryInfoResponse[]
  memoryTrash: MemoryInfoResponse[]
  memorySubjects: MemorySubjectInfoResponse[]
  dreamConfig: DreamConfigInfoResponse
  dreamRuns: DreamRunInfoResponse[]
  logs: LogEntryInfoResponse[]
  logLevel: LogLevel
  hooks: HookConfigInfoResponse
  remote: RemoteConfigInfoResponse
  remoteRunning: boolean
  ime: ImeConfigInfoResponse
  imeDictionaries: ImeDictionaryInfoResponse[]
  preferences: { [K in keyof PreferenceInfoValueByKey]: PreferenceInfoValueByKey[K] }
  serviceKeys: Set<string>
  planReview: PlanReviewInfoResponse
  /** Counter for ids minted while the page is open. */
  serial: number
}

function buildPlanReview(now: number): PlanReviewInfoResponse {
  const thread = buildThreads(now)[CONV.plan]
  const summary = thread.planReviews[0]
  const created = ago(39, now)
  return {
    document: {
      id: PLAN_DOCUMENT_ID,
      conversation_id: CONV.plan,
      state: 'reviewing',
      head_revision_id: PLAN_REVISION_ID,
      approved_revision_id: null,
      working_generation: 1,
      file_rel_path: 'plan.md',
      file_sync_state: 'applied',
      created_at: created,
      updated_at: created,
    },
    review: {
      id: PLAN_REVIEW_ID,
      document_id: PLAN_DOCUMENT_ID,
      submitted_revision_id: PLAN_REVISION_ID,
      state: 'pending',
      decision_id: null,
      suggestion_revision_id: null,
      assistant_message_id: summary.assistant_message_id,
      provider_call_id: summary.provider_call_id,
      turn_id: summary.turn_id,
      lock_version: 1,
      created_at: created,
      updated_at: created,
    },
    submitted_revision: {
      id: PLAN_REVISION_ID,
      document_id: PLAN_DOCUMENT_ID,
      revision_no: 1,
      parent_revision_id: null,
      author_kind: 'assistant',
      content_markdown: PLAN_MARKDOWN,
      content_sha256: 'demo0000000000000000000000000000000000000000000000000000000000000',
      patch: PLAN_MARKDOWN.split('\n')
        .map((line) => `+${line}`)
        .join('\n'),
      responding_to_suggestion_revision_id: null,
      assistant_message_id: summary.assistant_message_id,
      provider_call_id: summary.provider_call_id,
      editor_json: null,
      created_at: created,
    },
    parent_revision: null,
    draft: {
      review_id: PLAN_REVIEW_ID,
      base_revision_id: PLAN_REVISION_ID,
      generation: 0,
      mode: 'source',
      base_editor_json: null,
      draft_editor_json: null,
      source_text: null,
      base_normalized_markdown: PLAN_MARKDOWN,
      draft_normalized_markdown: PLAN_MARKDOWN,
      draft_sha256: 'demo0000000000000000000000000000000000000000000000000000000000000',
      global_note: null,
      selection: null,
      editor_schema_version: null,
      editor_schema_hash: null,
      created_at: created,
      updated_at: created,
    },
    comments: [],
  }
}

export interface DemoOptions {
  /** No question is waiting on anybody: the turns that were stopped on one read
   *  as interrupted instead, so no approval toast covers a screenshot. */
  quiet?: boolean
  /** Two commands running in the background in the rich conversation. Off
   *  unless asked for: a running command marks its conversation in the
   *  sidebar, and every other screenshot would change with it. */
  background?: boolean
}

export function createDemoState(options: DemoOptions = {}, now = Date.now()): DemoState {
  const threads = buildThreads(now)
  if (options.quiet) {
    for (const thread of Object.values(threads)) {
      thread.pending = []
      for (const t of thread.turns) {
        if (t.status !== 'running') continue
        t.status = 'interrupted'
        t.ended_at = t.started_at + 60_000
      }
    }
  }
  return {
    now,
    projects: buildProjects(now),
    // A card in every state the board draws: two backlog cards with no agent,
    // three running ones waiting on a person (a command to approve, an
    // `ask_user`, a plan to review), one finished under review, and one done
    // with its worktree removed. The running ones are the demo's own
    // conversations, so their cards and their transcripts agree.
    boardTasks: [
      {
        id: 'demo-card-approval',
        project_id: PROJECT_MERIDIAN,
        conversation_id: CONV.approval,
        source: 'local',
        title: 'release 构建体积',
        request: null,
        stage: 'running',
        position: 0,
        agent_kind: 'native',
        worktree_path: 'C:/Users/dev/Code/meridian.worktrees/approval',
        created_at: now - 7_200_000,
        updated_at: now - 600_000,
        worktree_removed_at: null,
      },
      {
        id: 'demo-card-ask',
        project_id: PROJECT_MERIDIAN,
        conversation_id: CONV.ask,
        source: 'local',
        title: '设置页导出入口',
        request: null,
        stage: 'running',
        position: 1,
        agent_kind: 'claude_code',
        worktree_path: 'C:/Users/dev/Code/meridian.worktrees/ask',
        created_at: now - 7_200_000,
        updated_at: now - 600_000,
        worktree_removed_at: null,
      },
      {
        id: 'demo-card-plan',
        project_id: PROJECT_MERIDIAN,
        conversation_id: CONV.plan,
        source: 'local',
        title: '导出功能计划',
        request: null,
        stage: 'running',
        position: 2,
        agent_kind: 'native',
        worktree_path: 'C:/Users/dev/Code/meridian.worktrees/plan',
        created_at: now - 7_200_000,
        updated_at: now - 600_000,
        worktree_removed_at: null,
      },
      {
        id: 'demo-card-rich',
        project_id: PROJECT_MERIDIAN,
        conversation_id: CONV.rich,
        source: 'local',
        title: '流式输出时回答写在屏幕外',
        request: null,
        stage: 'review',
        position: 0,
        agent_kind: 'native',
        worktree_path: 'C:/Users/dev/Code/meridian.worktrees/rich',
        created_at: now - 7_200_000,
        updated_at: now - 600_000,
        worktree_removed_at: null,
      },
      {
        id: 'demo-card-compact',
        project_id: PROJECT_MERIDIAN,
        conversation_id: CONV.compact,
        source: 'local',
        title: '压缩后的长对话',
        request: null,
        stage: 'done',
        position: 0,
        agent_kind: 'claude_code',
        worktree_path: null,
        created_at: now - 7_200_000,
        updated_at: now - 600_000,
        worktree_removed_at: now - 300_000,
      },

      {
        id: 'demo-card-csv',
        project_id: PROJECT_MERIDIAN,
        conversation_id: null,
        source: 'local',
        title: '导出 CSV 支持自定义列',
        request: '导出对话时让人选要哪些列',
        stage: 'backlog',
        position: 0,
        agent_kind: null,
        worktree_path: null,
        created_at: now - 3_600_000,
        updated_at: now - 3_600_000,
        worktree_removed_at: null,
      },
      {
        id: 'demo-card-virtual',
        project_id: PROJECT_MERIDIAN,
        conversation_id: null,
        source: 'local',
        title: '会话列表改虚拟滚动',
        request: null,
        stage: 'backlog',
        position: 1,
        agent_kind: null,
        worktree_path: null,
        created_at: now - 1_800_000,
        updated_at: now - 1_800_000,
        worktree_removed_at: null,
      },
    ],
    conversations: buildConversations(now, threads),
    threads,
    queues: {},
    // One that has already finished: the bar draws only running ones, so the
    // screenshots stay as they were, while the commands behind it have a row
    // to answer with.
    backgroundTasks: {
      [CONV.rich]: [
        ...(options.background ? runningDemoTasks(now) : []),
        {
          id: 'b1a2c3d4',
          conversation_id: CONV.rich,
          runner: 'native',
          kind: 'command',
          command: 'pnpm build',
          description: '构建前端',
          state: 'completed',
          exit_code: 0,
          ended_reason: null,
          output_bytes: 58,
          output_truncated: false,
          started_at: ago(30, now),
          ended_at: ago(29, now),
          notified: true,
        },
      ],
    },
    backgroundOutput: { b1a2c3d4: 'vite v7.1.4 building for production...\n✓ built in 41.2s\n' },
    drafts: {},
    providers: buildProviders(now),
    providerKeys: new Set(['demo-provider-anthropic', 'demo-provider-deepseek']),
    modelConfigs: buildModelConfigs(now),
    mediaGenerations: [
      {
        id: 'demo-media-1',
        capability_domain: 'image_gen',
        logical_model_id: null,
        deployment_id: null,
        provider_id: null,
        remote_model_id: 'gpt-image-1',
        protocol_id: 'openai_images',
        prompt: 'Demo alpine landscape',
        params_json: '{}',
        status: 'succeeded',
        progress_pct: 100,
        upstream_job_id: null,
        assets: [
          {
            file_uri: 'file:///demo/media_generations/demo-media-1/00.png',
            relative_path: 'demo-media-1/00.png',
            mime_type: 'image/png',
            bytes_len: 128,
            width: 1024,
            height: 1024,
            duration_seconds: null,
            revised_prompt: null,
            produce_id: 'produce-demo-1',
            is_ai_generated: true,
            watermark_snapshot: null,
          },
        ],
        error_message: null,
        conversation_id: null,
        source: 'studio',
        created_at: now,
        updated_at: now,
        completed_at: now,
      },
    ],
    assistants: buildAssistants(now),
    mcpServers: buildMcpServers(now),
    mcpDefaultPolicy: { scope: 'local_only', loading: 'deferred', approval: 'request_approve' },
    mcpConnected: new Set(['demo-mcp-filesystem', 'demo-mcp-github']),
    mcpDisabledTools: { 'demo-mcp-github': ['create_pull_request'] },
    customTools: buildCustomTools(now),
    toolPresets: buildToolPresets(now),
    skills: buildSkills(now),
    skillBindings: { 'global:': ['meridian-diagnostics'] },
    memories: buildMemories(now),
    memoryTrash: buildMemoryTrash(now),
    memorySubjects: buildMemorySubjects(now),
    dreamConfig: {
      enabled: false,
      model: null,
      cooldown_hours: 24,
      min_turns: 5,
      daily_budget_usd: decimal('0.5'),
    },
    dreamRuns: [
      {
        id: 'demo-dream-run-1',
        scope_type: 'project',
        scope_id: PROJECT_MERIDIAN,
        status: 'done',
        trigger: 'auto',
        model_id: 'claude-haiku-5',
        started_at: now - 3_600_000,
        finished_at: now - 3_598_000,
        turns_reviewed: 6,
        memories_created: 1,
        memories_updated: 1,
        memories_pruned: 1,
        proposals_created: 0,
        pruned_memory_ids: ['demo-mem-trash-1'],
        summary: 'Consolidated pnpm convention and pruned outdated Node 20 rule.',
        error: null,
      },
    ],
    logs: buildLogs(now),
    logLevel: 'info',
    hooks: buildHooksConfig(),
    remote: buildRemoteConfig(),
    remoteRunning: false,
    ime: { ...IME_CONFIG },
    imeDictionaries: IME_DICTIONARIES.map((d) => ({ ...d })),
    preferences: buildPreferences(),
    serviceKeys: new Set(['tavily']),
    planReview: buildPlanReview(now),
    serial: 0,
  }
}

/** The commands `?demo=background` leaves running. */
function runningDemoTasks(now: number): BackgroundTaskInfoResponse[] {
  const running = (id: string, command: string, description: string | null, minutes: number) => ({
    id,
    conversation_id: CONV.rich,
    runner: 'native' as const,
    kind: 'command' as const,
    command,
    description,
    state: 'running' as const,
    exit_code: null,
    ended_reason: null,
    output_bytes: 0,
    output_truncated: false,
    started_at: ago(minutes, now),
    ended_at: null,
    notified: false,
  })
  return [running('b9e1f2a3', 'pnpm dev', '前端开发服务器', 12), running('b7c4d5e6', 'cargo test --workspace', null, 2)]
}
