import type {
  AssistantInfoResponse,
  ComposerDraftInfoResponse,
  ConversationInfoResponse,
  CustomToolInfoResponse,
  EmojiInfoResponse,
  EmojiPackInfoResponse,
  HookConfigInfoResponse,
  ImeConfigInfoResponse,
  ImeDictionaryInfoResponse,
  ListenConfigInfoResponse,
  LogEntryInfoResponse,
  LogLevel,
  McpServerInfoResponse,
  MemoryInfoResponse,
  MemorySubjectInfoResponse,
  ModelConfigInfoResponse,
  OneBotConfigInfoResponse,
  PlanReviewInfoResponse,
  PreferenceInfoValueByKey,
  ProjectInfoResponse,
  ProviderInfoResponse,
  QueuedPromptInfoResponse,
  SkillInfoResponse,
  ToolPresetInfoResponse,
  VoiceCorpusSessionInfoResponse,
} from '@/types'
import {
  CONV,
  PLAN_DOCUMENT_ID,
  PLAN_MARKDOWN,
  PLAN_REVIEW_ID,
  PLAN_REVISION_ID,
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
  buildEmojiPacks,
  buildEmojis,
  buildHooksConfig,
  buildListenConfig,
  buildLogs,
  buildMcpServers,
  buildMemories,
  buildMemorySubjects,
  buildMemoryTrash,
  buildModelConfigs,
  buildOneBotConfig,
  buildPreferences,
  buildProviders,
  buildSkills,
  buildToolPresets,
  buildVoiceCorpus,
} from './settings'

/**
 * The whole in-memory backend. Built once per page load: writes persist for the
 * session and a reload starts over, which is what a fixture is for.
 */
export interface DemoState {
  now: number
  projects: ProjectInfoResponse[]
  conversations: ConversationInfoResponse[]
  threads: Record<string, DemoThread>
  queues: Record<string, QueuedPromptInfoResponse[]>
  /** Keyed by conversation id, `''` for the welcome composer. */
  drafts: Record<string, ComposerDraftInfoResponse>
  providers: ProviderInfoResponse[]
  providerKeys: Set<string>
  modelConfigs: ModelConfigInfoResponse[]
  assistants: AssistantInfoResponse[]
  mcpServers: McpServerInfoResponse[]
  mcpConnected: Set<string>
  customTools: CustomToolInfoResponse[]
  toolPresets: ToolPresetInfoResponse[]
  skills: SkillInfoResponse[]
  skillBindings: Record<string, string[]>
  memories: MemoryInfoResponse[]
  memoryTrash: MemoryInfoResponse[]
  memorySubjects: MemorySubjectInfoResponse[]
  logs: LogEntryInfoResponse[]
  logLevel: LogLevel
  onebot: OneBotConfigInfoResponse
  onebotRunning: boolean
  voiceCorpus: VoiceCorpusSessionInfoResponse[]
  hooks: HookConfigInfoResponse
  listen: ListenConfigInfoResponse
  listenRunning: boolean
  ime: ImeConfigInfoResponse
  imeDictionaries: ImeDictionaryInfoResponse[]
  emojiPacks: EmojiPackInfoResponse[]
  emojis: EmojiInfoResponse[]
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
    delivery: null,
  }
}

export interface DemoOptions {
  /** No question is waiting on anybody: the turns that were stopped on one read
   *  as interrupted instead, so no approval toast covers a screenshot. */
  quiet?: boolean
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
    conversations: buildConversations(now, threads),
    threads,
    queues: {},
    drafts: {},
    providers: buildProviders(now),
    providerKeys: new Set(['demo-provider-anthropic', 'demo-provider-deepseek']),
    modelConfigs: buildModelConfigs(now),
    assistants: buildAssistants(now),
    mcpServers: buildMcpServers(now),
    mcpConnected: new Set(['demo-mcp-filesystem', 'demo-mcp-github']),
    customTools: buildCustomTools(now),
    toolPresets: buildToolPresets(now),
    skills: buildSkills(now),
    skillBindings: { 'global:': ['meridian-diagnostics'] },
    memories: buildMemories(now),
    memoryTrash: buildMemoryTrash(now),
    memorySubjects: buildMemorySubjects(now),
    logs: buildLogs(now),
    logLevel: 'info',
    onebot: buildOneBotConfig(),
    onebotRunning: true,
    voiceCorpus: buildVoiceCorpus(now),
    hooks: buildHooksConfig(),
    listen: buildListenConfig(),
    listenRunning: false,
    ime: { ...IME_CONFIG },
    imeDictionaries: IME_DICTIONARIES.map((d) => ({ ...d })),
    emojiPacks: buildEmojiPacks(now),
    emojis: buildEmojis(now),
    preferences: buildPreferences(),
    serviceKeys: new Set(['TAVILY']),
    planReview: buildPlanReview(now),
    serial: 0,
  }
}
