import type { DecimalString } from './lib/decimal'

export type { DecimalString } from './lib/decimal'

export type AssistantListResponse = AssistantInfoResponse[]
export type ConversationListResponse = ConversationInfoResponse[]
export type ConversationSearchHitListResponse = ConversationSearchHitInfoResponse[]
export type EmojiPackListResponse = EmojiPackInfoResponse[]
export type EmojiListResponse = EmojiInfoResponse[]
export type JournalVersionListResponse = JournalVersionInfoResponse[]
export type McpServerListResponse = McpServerInfoResponse[]
export type MemoryListResponse = MemoryInfoResponse[]
export type MemorySubjectListResponse = MemorySubjectInfoResponse[]
export type ModelConfigListResponse = ModelConfigInfoResponse[]
export type ProjectListResponse = ProjectInfoResponse[]
export type PromptTemplateListResponse = PromptTemplateInfoResponse[]
export type ProviderListResponse = ProviderInfoResponse[]
export type QueuedPromptListResponse = QueuedPromptInfoResponse[]
export type SkillListResponse = SkillInfoResponse[]
export type SkillBindingNamesResponse = string[]
export type TodoItemListResponse = TodoItemInfoResponse[]
export type ToolCategoryListResponse = ToolCategoryInfoResponse[]
export type CustomToolListResponse = CustomToolInfoResponse[]
export type ToolPresetListResponse = ToolPresetInfoResponse[]
export type MessageListResponse = MessageInfoResponse[]
export type PendingApprovalListResponse = PendingApprovalInfoResponse[]
export type LogFileListResponse = LogFileInfoResponse[]
export type UsageBucketListResponse = UsageBucketInfoResponse[]
export type WorkspaceTreeEntryListResponse = WorkspaceTreeEntryInfoResponse[]
export type WorkspaceReferenceSuggestionListResponse = WorkspaceReferenceSuggestionInfoResponse[]
export type AcpLiveConversationIdsResponse = string[]
export type ListenAddressesResponse = string[]

export type SecretKey = 'REMOTE_TOKEN'

export interface SecretUpsertRequest {
  key: SecretKey
  value: string
}

export interface SecretReadRequest {
  key: SecretKey
}

export interface SecretDeleteRequest {
  key: SecretKey
}

export interface ConversationCreateRequest {
  title: string | null
  projectId: string | null
}

export interface ConversationCompactionRequest {
  conversationId: string
  customInstructions: string | null
}

export interface ConversationAssistantUpdateRequest {
  id: string
  assistantId: string | null
}

export interface ConversationTitleUpdateRequest {
  id: string
  title: string
}

export interface ConversationReasoningPreferencesUpdateRequest {
  id: string
  thinkingLevel: StoredThinkingLevel | null
  fastMode: boolean
}

export interface ConversationModeUpdateRequest {
  id: string
  mode: ChatMode | null
}

export interface ConversationAcceptEditsUpdateRequest {
  id: string
  acceptEdits: boolean
}

export interface ConversationProjectUpdateRequest {
  id: string
  projectId: string | null
}

export interface ConversationListByProjectRequest {
  projectId: string
  archived: boolean
}

export interface ConversationSearchRequest {
  query: string
  limit: number | null
}

export interface AssistantCreateRequest {
  name: string
  systemPrompt: string
  modelId: string | null
  temperature: number | null
  topP: number | null
  maxTokens: number | null
}

export interface AssistantUpdateRequest {
  id: string
  name?: string
  systemPrompt?: string
  providerId?: string | null
  modelId?: string | null
  temperature?: number | null
  contextLimit?: number
  enabledTools?: string[] | null
  thinkingEnabled?: boolean
  thinkingBudget?: number | null
  toolPresetId?: string | null
  autoCompactEnabled?: boolean
}

export interface EmojiPackCreateRequest {
  name: string
  description: string | null
}

export interface EmojiImportRequest {
  packId: string
  filePaths: string[]
}

export interface EmojiRenameRequest {
  id: string
  newName: string
}

export interface EmojiSemanticsConfirmRequest {
  id: string
  name: string
  tags: string | null
}

export interface AssistantEmojiPackAssignmentRequest {
  assistantId: string
  packId: string
}

export interface McpServerCreateRequest {
  name: string
  transportType: McpTransport
  command: string | null
  args: string[] | null
  env: Record<string, string> | null
  url: string | null
  headers: Record<string, string> | null
}

export interface McpServerUpdateRequest {
  id: string
  name?: string
  transportType?: McpTransport
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
  url?: string | null
  headers?: Record<string, string> | null
  isEnabled?: boolean
}

export interface MemoryUpsertRequest {
  projectId: string
  key: string
  content: string
  memoryType: MemoryType | null
}

export interface MemoryScopedUpsertRequest {
  scope: MemoryScope
  projectId: string | null
  subjectScopeId: string | null
  key: string
  content: string
  memoryType: MemoryType | null
  ownerOnly: boolean | null
}

export interface MemoryUpdateRequest {
  id: string
  content?: string
  memoryType?: MemoryType
  ownerOnly?: boolean
}

export interface MemorySubjectFlagsUpdateRequest {
  subjectScopeId: string
  isPinned: boolean | null
  optedOut: boolean | null
}

export interface ProjectCreateRequest {
  name: string
  path: string | null
  sourceType: ProjectSource
  sourceId: string | null
  assistantId: string | null
  description: string | null
}

export interface ProjectUpdateRequest {
  id: string
  name?: string
  path?: string
  assistantId?: string
  description?: string
}

export interface PromptTemplateCreateRequest {
  name: string
  category: string
  templateText: string
  description: string | null
}

export interface PromptTemplateUpdateRequest {
  id: string
  name?: string
  description?: string | null
  category?: string
  templateText?: string
}

export interface ProviderCreateRequest {
  name: string
  providerType: ProviderType
  baseUrl: string
  apiFormat: ProviderApiFormat | null
  catalogId: string | null
  authOption: string | null
}

export interface ProviderUpdateRequest {
  id: string
  name?: string
  providerType?: ProviderType
  baseUrl?: string
  isEnabled?: boolean
  apiFormat?: ProviderApiFormat
  credentialKind?: ProviderCredentialKind
  transportProfile?: ProviderTransportProfile
}

export interface ProviderKeyUpdateRequest {
  providerId: string
  apiKey: string
}

export interface ProviderModelListRequest {
  providerId: string
  forceRefresh: boolean | null
}

export interface ProviderCapabilitiesReadRequest {
  providerId: string
  modelId: string
}

export interface SkillCreateRequest {
  dirName: string
  llmDescription: string
  body: string
  displayName: string | null
}

export interface SkillUpdateRequest {
  dirName: string
  displayName?: string
  llmDescription?: string
  body?: string
  isEnabled?: boolean
}

export interface SkillBindingListRequest {
  layer: SkillLayer
  anchorId: string | null
}

export interface SkillBindingUpdateRequest {
  layer: SkillLayer
  anchorId: string | null
  dirName: string
  bound: boolean
}

export interface CustomToolCreateRequest {
  name: string
  description: string
  command: string
  categoryId: string | null
  parametersSchema: Record<string, unknown> | null
  argsTemplate: string | null
  workingDirectory: string | null
  timeoutMs: number | null
  permission: ToolPermission | null
}

export interface CustomToolUpdateRequest {
  id: string
  name?: string
  description?: string
  command?: string
  categoryId?: string | null
  parametersSchema?: Record<string, unknown>
  argsTemplate?: string | null
  workingDirectory?: string | null
  timeoutMs?: number | null
  permission?: ToolPermission
  isEnabled?: boolean
}

export type ToolPermission = 'always' | 'ask' | 'never'

export interface ToolPresetCreateRequest {
  name: string
  description: string | null
  toolNames: string[]
}

export interface ToolPresetUpdateRequest {
  id: string
  name?: string
  description?: string | null
  toolNames?: string[]
}

export interface ProjectInfoResponse {
  id: string
  name: string
  path: string | null
  source_type: ProjectSource
  source_id: string | null
  assistant_id: string | null
  description: string | null
  created_at: number
  updated_at: number
}

export type ProjectSource = 'local' | 'onebot_private' | 'onebot_group'

export type PreferenceKey =
  | 'shell'
  | 'sandbox.enabled'
  | 'search_provider'
  | 'voice.filter_level'
  | 'voice.download_url'
  | 'android.manage_storage_enabled'
  | 'autoreview.enabled'
  | 'autoreview.model'
  | 'autoreview.escalate'
  | 'autoreview.allow_rules'
  | 'autoreview.deny_rules'
  | 'autoreview.environment'
  | 'approvals.ttl_minutes'
  | 'sub_agent.explore.model'
  | 'sub_agent.agent.model'

export type ShellType = 'bash' | 'powershell' | 'cmd'
export type SandboxMode = 'auto' | 'container' | 'off'
export type SearchProvider = 'tavily' | 'zhipu'
export type VoiceFilterLevel = 'off' | 'standard' | 'aggressive'

export interface PreferenceModelSelectionRequest {
  providerId: string
  modelId: string
}

export interface PreferenceModelSelectionInfoResponse {
  provider_id: string
  model_id: string
}

export interface PreferenceReadRequest<K extends PreferenceKey = PreferenceKey> {
  key: K
}

export interface PreferenceInfoValueByKey {
  shell: ShellType | null
  'sandbox.enabled': SandboxMode | null
  search_provider: SearchProvider | null
  'voice.filter_level': VoiceFilterLevel | null
  'voice.download_url': string | null
  'android.manage_storage_enabled': boolean | null
  'autoreview.enabled': boolean | null
  'autoreview.model': PreferenceModelSelectionInfoResponse | null
  'autoreview.escalate': boolean | null
  'autoreview.allow_rules': string | null
  'autoreview.deny_rules': string | null
  'autoreview.environment': string | null
  'approvals.ttl_minutes': number | null
  'sub_agent.explore.model': PreferenceModelSelectionInfoResponse | null
  'sub_agent.agent.model': PreferenceModelSelectionInfoResponse | null
}

export type PreferenceInfoResponse<K extends PreferenceKey = PreferenceKey> = {
  [P in K]: { key: P; value: PreferenceInfoValueByKey[P] }
}[K]

export interface PreferenceUpdateValueByKey {
  shell: ShellType
  'sandbox.enabled': SandboxMode
  search_provider: SearchProvider
  'voice.filter_level': VoiceFilterLevel
  'voice.download_url': string | null
  'android.manage_storage_enabled': boolean
  'autoreview.enabled': boolean
  'autoreview.model': PreferenceModelSelectionRequest | null
  'autoreview.escalate': boolean
  'autoreview.allow_rules': string
  'autoreview.deny_rules': string
  'autoreview.environment': string
  'approvals.ttl_minutes': number
  'sub_agent.explore.model': PreferenceModelSelectionRequest | null
  'sub_agent.agent.model': PreferenceModelSelectionRequest | null
}

export type PreferenceUpdateRequest = {
  [P in PreferenceKey]: { key: P; value: PreferenceUpdateValueByKey[P] }
}[PreferenceKey]

export interface WorkspaceRootRequest {
  conversationId: string
}

/** Where a conversation's files live, or which of the three reasons there is
 *  nowhere to look. The empty states are distinct because they ask the user
 *  for three different actions. */
export type WorkspaceRootResponse =
  | { state: 'ok'; root: string; git_available: boolean; is_repo: boolean }
  | { state: 'no_project' }
  | { state: 'no_path' }
  | { state: 'missing_dir'; path: string }

export interface WorkspaceTreeRequest {
  conversationId: string
  dir: string | null
}

export interface WorkspaceTreeEntryInfoResponse {
  name: string
  /** Relative to the workspace root, `/`-separated on every platform. */
  rel_path: string
  is_dir: boolean
}

export interface WorkspaceFileReadRequest {
  conversationId: string
  relPath: string
}

export interface WorkspaceFileContentResponse {
  content: string
  truncated: boolean
  total_lines: number
  size_bytes: number
  binary: boolean
}

export interface WorkspaceReferenceRequest {
  path: string
  lineStart: number | null
  lineEnd: number | null
}

export interface WorkspaceReferenceSuggestRequest {
  conversationId: string | null
  projectId: string | null
  query: string
  limit: number | null
}

export interface WorkspaceReferenceSuggestionInfoResponse {
  path: string
  name: string
  is_dir: boolean
}

export type WorkspaceReferenceKind = 'project_file' | 'project_directory'
export type MessageContextKind = WorkspaceReferenceKind | 'shell_output' | 'conversation'

export interface WorkspaceReferenceResolveRequest {
  conversationId: string | null
  projectId: string | null
  path: string
  lineStart: number | null
  lineEnd: number | null
}

export interface WorkspaceReferencePreviewResponse {
  kind: WorkspaceReferenceKind
  path: string
  content: string
  line_start: number | null
  line_end: number | null
  byte_count: number
  line_count: number
  token_count: number
  truncated: boolean
}

export interface WorkspaceReferenceProbeRequest {
  conversationId: string | null
  projectId: string | null
  path: string
}

/** Metadata-only result used to distinguish real workspace paths from prose. */
export interface WorkspaceReferenceProbeResponse {
  kind: WorkspaceReferenceKind
  path: string
}

export interface MessageContextInfoResponse {
  id: string
  position: number
  kind: MessageContextKind
  display_path: string | null
  line_start: number | null
  line_end: number | null
  byte_count: number
  line_count: number
  token_count: number
  truncated: boolean
}

export interface MessageContextContentResponse {
  descriptor: MessageContextInfoResponse
  content: string
}

export interface MessageContextReadRequest {
  conversationId: string
  itemId: string
}

export interface ChatRequest {
  conversationId: string
  message: string | null
  turnId: string | null
  replaces: string | null
  modelOverride: string | null
  providerOverride: string | null
  thinkingLevel: StoredThinkingLevel | null
  assistantId: string | null
  fast: boolean | null
  mode: ChatMode | null
  voice: boolean | null
  contextRefs: WorkspaceReferenceRequest[] | null
  /** Conversations dragged into the composer, as ids. Separate from
   *  `contextRefs`: a drag leaves no `@` marker in the text for the backend's
   *  reconcile step, so these are validated on their own terms. */
  conversationRefs: string[] | null
}

export interface ChatStopRequest {
  conversationId: string
  turnId: string | null
}

export type UserCommandStatus = 'completed' | 'sandbox_denied' | 'timed_out' | 'cancelled' | 'failed' | 'in_doubt'
export type SandboxBackend = 'host' | 'windows_restricted_token' | 'container'

export interface UserCommandRunRequest {
  conversationId: string
  turnId: string
  command: string
  retryWithoutSandbox: boolean | null
}

export interface UserCommandResultReadRequest {
  conversationId: string
  messageId: string
}

/** The structured result of a literal `!` command. The model is not queried;
 *  the result is persisted as user-provided context for a later prompt. */
export interface UserCommandResultResponse {
  conversation_id: string
  turn_id: string
  message_id: string
  status: UserCommandStatus
  stdout: string
  stderr: string
  exit_code: number | null
  timed_out: boolean
  truncated: boolean
  sandbox: SandboxBackend | null
  duration_ms: number
  cwd: string
  host: string
  error: string | null
  /** True only for a Windows restricted-token denial. */
  can_retry_without_sandbox: boolean
  retry_without_sandbox: boolean
}

export type UserCommandEvent =
  | {
      type: 'start'
      conversation_id: string
      turn_id: string
      message_id: string
      cwd: string
      host: string
      retry_without_sandbox: boolean
    }
  | { type: 'finish'; result: UserCommandResultResponse }

export interface WorkspaceGitStatusRequest {
  conversationId: string
}

export type WorkspaceGitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface WorkspaceGitStatusEntryInfoResponse {
  path: string
  status: WorkspaceGitFileStatus
  renamed_from: string | null
}

export type WorkspaceGitStatusResponse =
  | { state: 'ok'; branch: string | null; files: WorkspaceGitStatusEntryInfoResponse[] }
  | { state: 'no_git' }
  | { state: 'not_repo' }

export interface WorkspaceGitDiffRequest {
  conversationId: string
  relPath: string | null
}

export interface WorkspaceGitDiffResponse {
  diff_text: string
  truncated: boolean
}

export interface WorkspaceEditorOpenRequest {
  conversationId: string
  relPath: string
  line: number | null
}

export type JournalBlameKind = 'conversation' | 'inferred' | 'external' | 'preexisting'

export interface JournalBlameRequest {
  conversationId: string
  relPath: string
}

export interface JournalFileHistoryRequest {
  conversationId: string
  relPath: string
}

export interface JournalVersionContentRequest {
  versionId: string
}

/** One contiguous run of lines with one origin. 1-based, inclusive. */
export interface JournalBlameSpanInfoResponse {
  start_line: number
  end_line: number
  /** `conversation` came from a turn; `inferred` was observed across a
   *  run_command bracket; `external` is a change nobody here made (or history
   *  the journal lost); `preexisting` predates the journal. */
  kind: JournalBlameKind
  conversation_id: string | null
  turn_id: string | null
  origin: TurnOrigin | null
  model_id: string | null
  tool_name: string | null
  timestamp: number | null
}

export interface JournalBlameResponse {
  /** Sha of the disk content this answer was computed against — re-fetch and
   *  compare to know the answer aged. */
  current_sha: string
  /** `null` = the journal has never seen this file. */
  head_sha: string | null
  /** The chain does not reach the file's beginning. */
  truncated: boolean
  spans: JournalBlameSpanInfoResponse[]
}

export interface JournalVersionContentResponse {
  content: string
}

export type JournalOperation =
  'write' | 'edit' | 'patch' | 'delete' | 'rename_from' | 'rename_to' | 'command_observed' | 'external' | 'rewind'

export type JournalSource = 'native' | 'hosted' | 'inferred' | 'external' | 'rewind'

/** One journalled version of a file, as stored. */
export interface JournalVersionInfoResponse {
  id: string
  file_id: string
  seq: number
  op: JournalOperation
  observed_old_sha: string | null
  new_sha: string | null
  source: JournalSource
  conversation_id: string | null
  turn_id: string | null
  project_id: string | null
  origin: TurnOrigin | null
  model_id: string | null
  tool_name: string | null
  moved_from_version_id: string | null
  created_at: number
}

export type MemoryScope = 'project' | 'client_global' | 'onebot_global' | 'onebot_user'
export type MemoryType = 'general' | 'preference' | 'fact' | 'instruction' | 'relationship'
export type MemoryOrigin = 'private' | 'group' | 'admin' | 'desktop' | 'legacy'
export type MemoryVisibility = 'normal' | 'owner_only'
export type MemoryDeletedBy = 'self' | 'admin' | 'lru'

/** Persisted memory fields are closed enums. `memory_enums` supplies display
 *  choices; it is not a compatibility escape hatch for unknown values. */
export interface MemoryInfoResponse {
  id: string
  scope_type: MemoryScope
  scope_id: string
  key: string
  content: string
  memory_type: MemoryType
  subject_scope_id: string | null
  origin: MemoryOrigin
  visibility: MemoryVisibility
  source_session_id: string | null
  deleted_at: number | null
  deleted_by: MemoryDeletedBy | null
  created_at: number
  updated_at: number
}

export type TodoItemStatus = 'pending' | 'in_progress' | 'completed'
export type TodoListStatus = 'in_progress' | 'completed'

export interface TodoItemInfoResponse {
  id: string
  list_id: string
  content: string
  /** Present-continuous phrasing, shown while this step is the one running. */
  active_form: string
  status: TodoItemStatus
  sort_order: number
  created_at: number
}

export interface TodoListInfoResponse {
  id: string
  conversation_id: string
  title: string
  status: TodoListStatus
  created_at: number
  updated_at: number
}

export interface TodoInfoResponse {
  list: TodoListInfoResponse
  items: TodoItemInfoResponse[]
}

export interface MemorySubjectInfoResponse {
  scope_id: string
  display_name: string | null
  last_seen_at: number
  created_at: number
  is_protected: boolean
  is_pinned: boolean
  opted_out: boolean
}

export interface MemoryEnumsResponse {
  scopes: MemoryScope[]
  origins: MemoryOrigin[]
  visibilities: MemoryVisibility[]
  memory_types: MemoryType[]
}

export interface ConversationInfoResponse {
  id: string
  title: string | null
  assistant_id: string | null
  is_pinned: boolean
  is_archived: boolean
  message_count: number
  created_at: number
  updated_at: number
  project_id: string | null
  /** Per-conversation reasoning tier; null means inherit the assistant default. */
  thinking_level: StoredThinkingLevel | null
  fast_mode: boolean
  /** Collaboration mode; null is the default (work) mode. */
  mode: ChatMode | null
  /** Leaf the active path ends at. Null falls back to the newest message. */
  head_message_id: string | null
  /**
   * Standing approval for ordinary edits inside the project. What it widens is
   * bounded in the backend, not here: never outside the project, never anything
   * irreversible, never a path that makes code run later.
   */
  accept_edits: boolean
  /**
   * `claude_code` for a hosted ACP session, `plan_review` / `impl_review` for a
   * gate's transcript, absent for an ordinary conversation. What the composer
   * reads to decide which backend command a message goes to.
   */
  parent_conversation_id: string | null
  spawned_by_message_id: string | null
  spawned_by_call_id: string | null
  spawned_turn_id: string | null
  agent_kind: ConversationAgentKind | null
  agent_provider_id: string | null
  agent_model_id: string | null
}

/** One conversation whose transcript says the search query, with a snippet
 *  around the newest mention. What `search_conversations` returns. */
export interface ConversationSearchHitInfoResponse {
  conversation_id: string
  title: string | null
  role: TranscriptRole
  snippet: string
  created_at: number
}

export type TranscriptRole = 'user' | 'assistant'

/** Stored ACP adapter settings returned by the host. */
export interface AcpConfigInfoResponse {
  command: string
  args: string[]
}

/** Complete ACP adapter settings accepted by the host. */
export interface AcpConfigUpdateRequest {
  command: string
  args: string[]
}

export interface AcpSessionOpenRequest {
  cwd: string
}

export interface AcpPromptSendRequest {
  conversationId: string
  message: string
  turnId: string | null
  contextRefs: WorkspaceReferenceRequest[] | null
  conversationRefs: string[] | null
}

export interface AcpSessionAttachRequest {
  conversationId: string
  sessionId: string
  cwd: string
}

/**
 * One knob the hosted agent exposes for a session.
 *
 * ACP has no model field: the model is one of these, with `category: 'model'`.
 * Which values a `select` accepts is the agent's to decide and changes under
 * us — picking a model re-derives which modes exist — so this is never
 * hardcoded, only rendered.
 */
export interface AcpConfigOptionInfoResponse {
  id: string
  name: string
  description: string | null
  /** `model` | `mode` | `effort` | … Advisory; `id` is the fallback. */
  category: string | null
  /** `select` | `boolean`. Only `select` is drawn as a picker. */
  type: string | null
  /** A value id for a select, a boolean for a toggle. */
  currentValue: unknown
  options: AcpConfigOptionValueInfoResponse[]
}

export interface AcpConfigOptionValueInfoResponse {
  value: string
  name: string
  description: string | null
}

export type AcpConfigOptionListResponse = AcpConfigOptionInfoResponse[]

export interface AcpSessionConfigReadRequest {
  conversationId: string
}

export interface AcpSessionConfigUpdateRequest {
  conversationId: string
  configId: string
  value: unknown
}

/**
 * A Claude Code session the agent found on this machine.
 *
 * camelCase because most of it is the ACP `SessionInfo` passed straight
 * through, the way `AcpConfigOptionInfoResponse` is.
 */
export interface AcpDiscoveredSessionInfoResponse {
  sessionId: string
  /** Absolute, and where the session's work happened. */
  cwd: string
  /** The SDK's own summary: a `/rename` if there was one, else a generated
   *  line, else the first prompt. Absent for a session too new to have one. */
  title: string | null
  /** ISO 8601. */
  updatedAt: string | null
  /**
   * The conversation here that already resumes this session.
   *
   * Sessions Meridian started come back in this list too — the adapter has no
   * way to leave them out — so they are marked rather than hidden.
   */
  ownedBy: string | null
}

export type AcpDiscoveredSessionListResponse = AcpDiscoveredSessionInfoResponse[]

/** Complete discovery scope. `cwd: null` means every project. */
export interface AcpSessionListRequest {
  cwd: string | null
}

/** Complete description of the discovered session selected for import. */
export interface AcpImportSessionRequest {
  sessionId: string
  cwd: string
  title: string | null
  updatedAt: string | null
}

/** What one import produced. */
export interface AcpImportSessionResponse {
  conversationId: string
  /**
   * Only the tail of the session came back.
   *
   * Above 5 MiB the Claude Agent SDK replays just what follows the last
   * compaction — no flag, no warning, no marker on the wire. The one signal is
   * its own summary at the head of the recital, and this is the only place the
   * user will ever be told.
   */
  truncated: boolean
  messages: number
}

/** Which agent session a hosted conversation follows, and where it works. */
export interface AcpConversationSessionInfoResponse {
  cwd: string
  /** `null` for a conversation from before the session table existed, which is
   *  exactly the one worth attaching to something. */
  acp_session_id: string | null
}

/**
 * When a queued message is handed to the agent.
 *
 * Not urgency levels — two different points in the run. `follow_up` waits for
 * the turn to reach an ending and then starts a new one; `interject` goes in at
 * the next point the agent accepts input, between rounds of the turn already
 * going. Claude Code offers only the second, which makes every thought you
 * queue while something long runs an interruption.
 */
export type QueueDelivery = 'follow_up' | 'interject'

export interface QueuedPromptCreateRequest {
  conversationId: string
  content: string
  delivery: QueueDelivery
  contextRefs: WorkspaceReferenceRequest[] | null
  conversationRefs: string[] | null
}

export interface QueuedPromptDeliveryUpdateRequest {
  conversationId: string
  id: string
  delivery: QueueDelivery
}

export interface QueuedPromptRemoveRequest {
  conversationId: string
  id: string
}

export interface QueuedPromptReorderRequest {
  conversationId: string
  ids: string[]
}

/**
 * Where a queued message has got to. Derived on the backend from which
 * timestamps are set, never stored — see the migration.
 *
 * `in_doubt` is the one worth drawing differently: it was handed over and what
 * became of it is not known. It is never sent again, and it stops everything
 * behind it until the agent has been told about it.
 */
export type QueueState = 'queued' | 'in_doubt' | 'settled' | 'held'

export interface QueuedPromptInfoResponse {
  id: string
  conversation_id: string
  content: string
  delivery: QueueDelivery
  position: number
  created_at: number
  dispatched_at: number | null
  dispatched_turn_id: string | null
  settled_at: number | null
  settled_message_id: string | null
  held_at: number | null
  reported_at: number | null
}

/** What the settings page learned by starting the adapter and greeting it. */
export interface AcpCheckResponse {
  ok: boolean
  agent: string | null
  protocol_version: number | null
  load_session: boolean
  error: string | null
}

/** A step on the active path that was answered more than once. */
export interface BranchPointInfoResponse {
  /** The version currently on the path. */
  message_id: string
  /** 0-based position among `sibling_ids`. */
  index: number
  total: number
  /** Every version, oldest first, so paging is stable across reloads. */
  sibling_ids: string[]
}

export type BranchPointListResponse = BranchPointInfoResponse[]

/** One snapshot of a conversation: the active path plus where it can be paged.
 *  Returned whole so the two can never disagree on screen. */
export interface MessageTreeResponse {
  messages: MessageListResponse
  head_message_id: string | null
  branches: BranchPointListResponse
}

export interface MessageBranchSwitchRequest {
  conversationId: string
  messageId: string
}

export interface MessageDeleteRequest {
  conversationId: string
  id: string
}

/** Ids must match `agent::modes` on the Rust side. */
export type ChatMode = 'work' | 'plan'

/** Persisted and wire-visible kinds for a conversation snapshot. */
export type ConversationAgentKind = 'explore' | 'agent' | 'claude_code' | 'plan_review' | 'impl_review'

/** The only two kinds a `run_agent` delegated run can create. */
export type SubAgentKind = 'explore' | 'agent'

export interface ToolCallDisplay {
  call_id: string
  tool_name: string
  arguments: string
  /** `orphaned` is a call the transcript shows as unanswered while nothing is
   *  waiting for a decision on it — its turn died. In the database it looks
   *  exactly like a pending call, so only the live registry tells them apart,
   *  and only a pending one gets buttons.
   *
   *  `queued` is never stored and never arrives in an event. A reply's calls run
   *  one at a time in the order the model wrote them, so only the first
   *  unanswered one is doing anything; the rest read as `running` from the
   *  transcript and are corrected at render from their position. Keeping it out
   *  of the store is the point — a stored copy would have to be promoted every
   *  time a result landed, and would be wrong in between.
   *
   *  `awaiting_parent` is a delegated run's call, seen from inside the
   *  sub-agent. It is genuinely waiting on a person, but not on anyone reading
   *  this transcript — the question was put on the card that spawned the run,
   *  which is where somebody is actually looking. Drawn without buttons, so
   *  there is only ever one place an answer can come from. */
  status:
    'pending' | 'approved' | 'denied' | 'running' | 'queued' | 'completed' | 'error' | 'orphaned' | 'awaiting_parent'
  result?: string
  /** What the buttons answer with while this call is `pending`. Minted by the
   *  backend per approval rather than taken from the provider's call id, which
   *  some OpenAI-compatible gateways reuse. A pending call without one cannot
   *  be answered, and is shown as `orphaned` rather than falling back to
   *  `call_id`. */
  approval_id?: string
  /** A durable plan review associated with this call. Unlike `approval_id`,
   *  this survives process restarts and never addresses an in-memory waiter. */
  plan_review_id?: string
  /** Present exactly when this is a sandbox-blocked call asking to be retried
   *  without the sandbox. The retry reuses the original call id. */
  retry_reason?: string
  /** Set on a `run_agent` call once its run exists. */
  sub_agent?: SubAgentRunDisplay
  /** A question the delegated run is asking. It belongs to a tool call in
   *  another conversation, so it arrives as a whole rather than as a status on
   *  this card — this card's own status stays `running`, because `run_agent`
   *  really is still going. */
  nested_approval?: NestedApproval
  /** Set when this call was decided by the automatic reviewer rather than by a
   *  person. Shown beside the status so a denial does not read as the model
   *  giving up on its own. */
  auto_review?: AutoReviewVerdictInfoResponse
  /** What a hosted agent said this Edit/Write changed, one entry per hunk.
   *  Preferred over the diff derived from the arguments when present: it
   *  carries the file's pre-overwrite text and each hunk's line. */
  diffs?: ToolCallDiffInfoResponse[]
}

/** One hunk of the diff a hosted agent reported. `old_text` is null for a
 *  file that did not exist; `line` is the hunk's first line after the edit,
 *  null when the adapter did not say. */
export interface ToolCallDiffInfoResponse {
  path: string
  old_text: string | null
  new_text: string
  line: number | null
}

/** The delegated run a `run_agent` call started. */
export interface SubAgentRunDisplay {
  /** Where it is happening. Hidden from the sidebar; reachable only from here. */
  conversation_id: string
  /** The run itself. The card counts steps against this rather than against the
   *  conversation, whose later turns may be a follow-up chat. */
  turn_id: string
  kind: SubAgentKind
  /** Assistant iterations — how many times the model was asked. From the
   *  snapshot; while the run is live the store's own counter is ahead of it. */
  steps: number
  /** How the run's turn ended, as the backend has it — `running` while it is
   *  going, `null` for a run whose turn row is gone. The card reads its verdict
   *  off this and parses the result's opening sentence only as a fallback. */
  status: TurnStatus | null
}

export interface ConversationSteerRequest {
  conversationId: string
  text: string
}

/** A tool call inside a delegated run, waiting on the person watching the
 *  parent. */
export interface NestedApproval {
  approval_id: string
  /** The call id *in the sub-agent's conversation*. Never used to place this —
   *  the `run_agent` card is what places it — only to say what is being asked. */
  call_id: string
  tool_name: string
  arguments: string
  retry_reason?: string
  /** Where to go to watch what led to the question. */
  sub_conversation_id?: string
}

/** One run of the agent loop, as the backend recorded it.
 *
 *  `status` is not a raw column. A turn that stopped without recording an
 *  ending leaves `running` behind, and only startup reconciliation rewrites
 *  that, so the stored value alone would have a turn that ended an hour ago
 *  read as one still going. The backend decides against its live register of
 *  what is running and sends the answer; there is nothing here that could
 *  ask — which is also why nothing here should read a cause into it. */
export interface TurnInfoResponse {
  id: string
  status: TurnStatus
  /** What it was doing when it last said anything: `streaming` |
   *  `awaiting_approval` | `running_tool` | `compacting`. Written before the
   *  thing it names, so on an interrupted turn this is where it died. */
  phase: TurnPhase | null
  /** The call `phase` refers to, when it refers to one. */
  phase_tool: string | null
  error: string | null
  started_at: number
  ended_at: number | null
  /** Aggregated from the immutable audit rows for this run. */
  usage: TurnUsageInfoResponse | null
}

export type TurnStatus = 'running' | 'waiting_review' | 'done' | 'cancelled' | 'failed' | 'interrupted'
export type TurnPhase = 'streaming' | 'awaiting_approval' | 'running_tool' | 'compacting'

export type TurnPricingStatus = 'exact' | 'estimated' | 'lower_bound' | 'subscription' | 'external' | 'unavailable'

/** The backend-priced usage of one agent-loop run. Cost fields are outputs,
 *  never rates for the frontend to apply to the token fields. */
export interface TurnUsageInfoResponse {
  messages: number
  /** Replies where the provider supplied none of the token usage fields. */
  missing_token_usage_messages: number
  /** Replies missing either input or output token usage. */
  incomplete_token_usage_messages: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  server_tool_calls: number
  input_cost: DecimalString | null
  output_cost: DecimalString | null
  cache_cost: DecimalString | null
  tool_cost: DecimalString | null
  total_cost: DecimalString | null
  unpriced_token_messages: number
  unpriced_input_messages: number
  unpriced_output_messages: number
  unpriced_cache_messages: number
  unpriced_tool_messages: number
  estimated_token_messages: number
  estimated_tool_messages: number
  estimated_messages: number
  unpriced_messages: number
  metered_messages: number
  subscription_messages: number
  external_messages: number
  pricing_status: TurnPricingStatus
}

export type PlanDocumentState = 'drafting' | 'reviewing' | 'approved' | 'done'
export type PlanReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'orphaned'
export type PlanRevisionAuthorKind = 'assistant' | 'user_suggestion' | 'legacy'
export type PlanReviewDraftMode = 'rich' | 'source'
export type PlanCommentState = 'draft' | 'active' | 'orphaned' | 'submitted' | 'deleted'
export type PlanReviewDeliveryTarget = 'native' | 'acp'
export type PlanReviewDeliveryState = 'queued' | 'dispatched' | 'acknowledged' | 'held' | 'in_doubt'
export type PlanFileSyncState = 'pending' | 'applied' | 'conflict'

export interface PlanProseMirrorRange {
  kind: 'prosemirror_range'
  from: number
  to: number
  quote: string
  prefix: string
  suffix: string
}

export interface PlanSourceRange {
  kind: 'source_range'
  from: number
  to: number
  quote: string
  prefix: string
  suffix: string
}

export type PlanCommentAnchor = PlanProseMirrorRange | PlanSourceRange

export interface PlanDocumentInfoResponse {
  id: string
  conversation_id: string
  state: PlanDocumentState
  head_revision_id: string | null
  approved_revision_id: string | null
  working_generation: number
  file_rel_path: string
  file_sync_state: PlanFileSyncState
  created_at: number
  updated_at: number
}

export interface PlanRevisionInfoResponse {
  id: string
  document_id: string
  revision_no: number
  parent_revision_id: string | null
  author_kind: PlanRevisionAuthorKind
  content_markdown: string
  content_sha256: string
  patch: string | null
  responding_to_suggestion_revision_id: string | null
  assistant_message_id: string | null
  provider_call_id: string | null
  editor_json: JsonValue | null
  created_at: number
}

export type PlanRevisionListResponse = PlanRevisionInfoResponse[]

export interface PlanReviewSessionInfoResponse {
  id: string
  document_id: string
  submitted_revision_id: string
  state: PlanReviewStatus
  decision_id: string | null
  suggestion_revision_id: string | null
  assistant_message_id: string
  provider_call_id: string
  turn_id: string
  lock_version: number
  created_at: number
  updated_at: number
}

export interface PlanReviewSummaryInfoResponse {
  review_id: string
  conversation_id: string
  document_id: string
  revision_id: string
  assistant_message_id: string
  provider_call_id: string
  turn_id: string
  status: PlanReviewStatus
  /** Latest continuation delivery. A settled review remains a conversation
   *  barrier until this reaches `acknowledged`. */
  delivery_state: PlanReviewDeliveryState | null
  lock_version: number
}

export type PlanReviewSummaryListResponse = PlanReviewSummaryInfoResponse[]

export interface PlanReviewDraftInfoResponse {
  review_id: string
  base_revision_id: string
  generation: number
  mode: PlanReviewDraftMode
  base_editor_json: JsonValue | null
  draft_editor_json: JsonValue | null
  source_text: string | null
  base_normalized_markdown: string
  draft_normalized_markdown: string
  draft_sha256: string
  global_note: string | null
  selection: PlanCommentAnchor | null
  editor_schema_version: number | null
  editor_schema_hash: string | null
  created_at: number
  updated_at: number
}

export interface PlanCommentInfoResponse {
  id: string
  review_id: string
  position: number
  state: PlanCommentState
  anchor: PlanCommentAnchor
  body: string
  created_at: number
  updated_at: number
}

export type PlanCommentListResponse = PlanCommentInfoResponse[]

export interface PlanReviewDeliveryInfoResponse {
  id: string
  review_id: string
  target: PlanReviewDeliveryTarget
  state: PlanReviewDeliveryState
  payload: JsonValue
  error: string | null
  created_at: number
  updated_at: number
}

export interface PlanReviewInfoResponse {
  document: PlanDocumentInfoResponse
  review: PlanReviewSessionInfoResponse
  submitted_revision: PlanRevisionInfoResponse
  parent_revision: PlanRevisionInfoResponse | null
  draft: PlanReviewDraftInfoResponse
  comments: PlanCommentListResponse
  delivery: PlanReviewDeliveryInfoResponse | null
}

export interface PlanReviewReadRequest {
  reviewId: string
}

export interface PlanRevisionListRequest {
  documentId: string
}

export interface PlanCommentDraftRequest {
  id: string
  state: PlanCommentState
  anchor: PlanCommentAnchor
  body: string
}

export interface PlanReviewDraftSaveRequest {
  reviewId: string
  expectedGeneration: number
  mode: PlanReviewDraftMode
  baseEditorJson: JsonValue | null
  baseNormalizedMarkdown: string
  editorJson: JsonValue | null
  sourceText: string | null
  normalizedMarkdown: string
  comments: PlanCommentDraftRequest[]
  globalNote: string | null
  selection: PlanCommentAnchor | null
  editorSchemaVersion: number | null
  editorSchemaHash: string | null
  editorSchemaFallback: {
    fromVersion: number
    fromHash: string | null
  } | null
}

export interface PlanReviewDraftSaveResponse {
  review_id: string
  generation: number
  draft_sha256: string
  updated_at: number
}

export interface PlanReviewDraftDiscardRequest {
  reviewId: string
  expectedGeneration: number
}

export type PlanReviewDecisionAction = 'approve' | 'request_changes'

export interface PlanReviewDecisionRequest {
  reviewId: string
  decisionId: string
  expectedGeneration: number
  expectedDraftHash: string
  action: PlanReviewDecisionAction
}

export interface PlanReviewDecisionResponse {
  review_id: string
  state: PlanReviewStatus
  delivery_state: PlanReviewDeliveryState | null
  continuation_turn_id: string | null
}

export interface PlanReviewDeliveryReadRequest {
  reviewId: string
}

export interface PlanReviewDeliveryContinueRequest {
  deliveryId: string
}

export interface PlanFileConflictResolveRequest {
  documentId: string
  action: 'restore_db'
}

/** A conversation as of one instant.
 *
 *  Replaces three parallel requests. Those could interleave with a running turn
 *  — the tree fetched before a tool result landed, the turns after — and the
 *  result was a conversation that was never true at any moment. */
export interface ConversationSnapshotResponse {
  conversation: ConversationInfoResponse
  tree: MessageTreeResponse
  turns: TurnListResponse
  pending_approvals: PendingApprovalListResponse
  /** Plan reviews on the active transcript path, including settled reviews so
   *  historical cards remain navigable after a reload. */
  plan_reviews: PlanReviewSummaryListResponse
  /** Conversation-wide hard barrier. This remains true even if no plan review
   *  card is visible on the active transcript path. */
  plan_review_barrier: boolean
  /** Empty for every conversation that has never delegated. */
  sub_agent_runs: SubAgentRunListResponse
  /** What a hosted Claude Code session reported about itself — failures and
   *  warnings at their latest revision. Empty for a native conversation. */
  acp_notices: AcpSessionNoticeListResponse
}

/** The group a hosted session's incident belongs to. Drives the icon and
 *  nothing else; the text is the message. */
export type AcpNoticeCategory = 'connection' | 'access' | 'limit' | 'request' | 'service' | 'unknown'
/** A `warning` never ended a turn; an `error` needs a person or another request. */
export type AcpNoticeSeverity = 'warning' | 'error'
/** What the adapter recommends. The app decides which it can offer. */
export type AcpNoticeAction = 'retry' | 'login' | 'new_session'

/** One incident a hosted Claude Code session reported, at its latest revision.
 *  Keyed by `notice_id` — the adapter's own id — and replaced in place when a
 *  higher `revision` arrives. `turn_id` is null for a session-scoped one. */
export interface AcpSessionNoticeInfoResponse {
  id: string
  conversation_id: string
  turn_id: string | null
  notice_id: string
  revision: number
  category: AcpNoticeCategory
  severity: AcpNoticeSeverity
  title: string
  details: string | null
  reason: string | null
  actions: AcpNoticeAction[]
  created_at: number
  updated_at: number
}

export type AcpSessionNoticeListResponse = AcpSessionNoticeInfoResponse[]

export interface ConversationSnapshotRequest {
  conversationId: string
}

export type TurnListResponse = TurnInfoResponse[]
export type SubAgentRunListResponse = SubAgentRunInfoResponse[]

/** One delegated run, as the conversation that started it sees it. */
export interface SubAgentRunInfoResponse {
  conversation_id: string
  /** Which `run_agent` call started it — both halves, because a provider call
   *  id repeats across the rows of one conversation. */
  spawned_by_message_id: string | null
  spawned_by_call_id: string | null
  spawned_turn_id: string | null
  agent_kind: SubAgentKind
  title: string | null
  steps: number
  /** Already folded against the live register, so `running` here means running.
   *  `null` when the delegating turn's row has gone. */
  status: TurnStatus | null
}

/** A tool call the backend is still holding a turn open for. Recovered on load,
 *  since the streamed event that first announced it is gone by then. */
export interface PendingApprovalInfoResponse {
  approval_id: string
  /** Which conversation this view belongs to. Redundant inside a snapshot,
   *  which was asked for one; the whole point in `allPendingApprovals`, where a
   *  question has no transcript around it to say where it came from. */
  conversation_id: string
  /** The row the card hangs off *in this conversation*. For a delegated run the
   *  parent names its own `run_agent` row and the sub-agent names the row the
   *  call is on. */
  assistant_message_id: string
  provider_call_id: string
  /** The call this one retries. Non-null only for sandbox escalations, where it
   *  currently equals `provider_call_id` — a retry reuses the id. */
  origin_call_id: string | null
  tool_name: string
  /** What the tool was called with. Sent rather than read off the transcript,
   *  because a delegated call's row is in another conversation. */
  arguments: string
  retry_reason: string | null
  /** Shown here, answered elsewhere: this belongs to a delegated run and the
   *  card draws without buttons. */
  bubbled: boolean
  /** Which `run_agent` call to nest the card under. Non-null only in the parent's view. */
  parent_call_id: string | null
  /** Where the delegated run can be watched. Non-null only in the parent's view. */
  sub_conversation_id: string | null
}

export interface ToolCallDenyRequest {
  approvalId: string
  reason: string | null
}

export interface AskResponseRequest {
  approvalId: string
  response: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; data: ToolCallDisplay }
  | { type: 'sticker'; sticker_id: string; name?: string }

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type UploadFileResponse =
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { url: string; mime_type: string; name: string } }

export type MessageRating = -1 | 1

export interface MessageRatingUpdateRequest {
  id: string
  rating: MessageRating | null
}

export type ConversationExportFormat = 'sft' | 'dpo'

export interface ConversationExportRequest {
  conversationId: string
  format: ConversationExportFormat
  outputPath: string | null
}

export interface ConversationExportResponse {
  path: string
}

export interface MessageFileUploadRequest {
  conversationId: string
  filePath: string
}

export interface MessageFileBytesUploadRequest {
  conversationId: string
  fileName: string
  /** The file's bytes, base64-encoded — Android has no raw IPC, and one
   *  encoding shared by every platform beats a fast path only some have. */
  dataBase64: string
}

export interface VoiceModelStatusInfoResponse {
  installed: boolean
  path: string | null
  size_bytes: number
  downloading: boolean
}

export interface VoiceModelDownloadRequest {
  url: string | null
}

export interface VoiceModelImportRequest {
  archivePath: string
}

export interface VoicePcmTranscriptionRequest {
  sampleRate: number
  pcm: string
}

export interface VoiceProbeEchoRequest {
  sampleRate: number
  pcm: string
}

export type VoiceTranscriptStatus = 'ok' | 'too_short' | 'empty'

export interface VoiceTranscriptResponse {
  status: VoiceTranscriptStatus
  text: string
  duration_ms: number
}

export type VoiceCorpusSessionKind = 'group' | 'private'

export interface VoiceCorpusSessionInfoResponse {
  handle: string
  kind: VoiceCorpusSessionKind
  clips: number
  bytes: number
  untranscribed: number
  last_captured_at: number
}

export type VoiceCorpusSessionListResponse = VoiceCorpusSessionInfoResponse[]

export type VoiceCorpusDeleteSelector =
  { kind: 'session'; handle: string } | { kind: 'sender'; id: string } | { kind: 'all'; confirmation: string }

export interface VoiceCorpusDeleteRequest {
  selector: VoiceCorpusDeleteSelector
}

export interface VoiceCorpusOptoutUpdateRequest {
  senderId: string
  enabled: boolean
}

export interface VoiceCorpusForgetRequest {
  senderId: string
}

export interface VoiceCorpusExportRequest {
  outputDir: string
  includeSender: boolean
  includeUntranscribed: boolean
}

export interface VoiceCorpusDeleteResponse {
  clips: number
  files: number
  bytes: number
  failures: string[]
}

export interface VoiceCorpusForgetResponse {
  clips: number
  files: number
  bytes: number
  failures: string[]
}

export interface VoiceCorpusExportResponse {
  clips: number
  skipped: number
  bytes: number
  path: string
}

export interface MessageInfoResponse {
  id: string
  conversation_id: string
  /** `context` is background the backend injected and froze into the history —
   *  memories, mostly. Nobody said it, so it is not drawn: `chat-view` keeps
   *  only user and assistant rows. Its `content` and internal source metadata
   *  are redacted at the IPC boundary; the row remains only to preserve the
   *  branch shape. */
  role: 'user' | 'assistant' | 'tool' | 'context'
  content: string
  provider_id: string | null
  model_id: string | null
  input_tokens: number | null
  output_tokens: number | null
  /**
   * Subsets of `input_tokens`, never additions to it — the provider layer
   * normalises every upstream to that contract. `null` is an upstream that said
   * nothing about caching, which is not the same as one that said nothing was
   * cached; a hit rate that reads the first as a miss reports a silent provider
   * as a total cache failure.
   */
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  /** Which upstream answered, by the name it had at the time. */
  provider_name: string | null
  /** Parsed persisted message blocks/tool calls. SQLite's JSON encoding does not cross IPC. */
  tool_calls: OpenAIToolCall[] | null
  tool_call_id: string | null
  sort_order: number
  created_at: number
  reasoning_content: string | null
  rating: MessageRating | null
  is_compact_summary: boolean
  /** The message this one answers or follows. Siblings under one parent are
   *  alternative versions of the same step. Null marks a root. */
  parent_id: string | null
  /** How the message was produced: null for typed, `voice` for speech input,
   *  `shell` for a literal user-authored `!` command. */
  source: 'voice' | 'shell' | null
  /** Platform id of whoever sent this, on surfaces where more than one person
   *  can speak. Null on desktop rows, which have a single implicit author, and
   *  on history written before speakers were attributed. The nickname is not
   *  stored alongside it — nicknames change, so they are looked up separately. */
  sender_id: number | null
  /** Only on compaction summaries: the first message the summary stands in
   *  front of. */
  compact_anchor_id: string | null
  /** Which run of the agent loop wrote this row. Null on rows written before
   *  turns were recorded, and on compaction summaries, which belong to no one
   *  turn's output. */
  turn_id: string | null
  /** Only on `role: 'tool'` rows: `success` | `denied` | `error`. Null reads as
   *  success — rows written before the column existed all claimed as much. */
  tool_outcome: ToolOutcome | null
  /** Automatic-review verdicts keyed by provider call id. */
  auto_review: Record<string, AutoReviewVerdictInfoResponse> | null
  /** The diff a hosted agent reported per Edit/Write call, keyed by call id.
   *  Null on every row the agent reported nothing for. */
  tool_diffs: Record<string, ToolCallDiffInfoResponse[]> | null
  /** Frozen context bound to this branch. The raw body is fetched separately
   *  and never travels in an ordinary transcript snapshot. */
  context_items: MessageContextInfoResponse[]
}

/** A transcript row after the front end has derived its renderable blocks. */
export interface MessageViewModel extends MessageInfoResponse {
  _blocks?: ContentBlock[]
}

/** What an automatic reviewer decided about one tool call.
 *
 *  `outcome: 'unreadable'` is neither an approval nor a refusal: the review ran
 *  and produced nothing usable, so the decision fell back to whoever was
 *  watching. It is recorded because a review that cost money and answered
 *  nothing is worth being able to see. */
export interface AutoReviewEvidenceInfoResponse {
  tool: string
  arguments: string
}

export interface AutoReviewVerdictInfoResponse {
  outcome: 'allow' | 'deny' | 'unreadable'
  risk: 'low' | 'medium' | 'high' | 'critical' | null
  authorization: 'unknown' | 'low' | 'medium' | 'high' | null
  rationale: string | null
  /** `quick` for the single-request pass, `investigate` when it went and read
   *  the repository before deciding. */
  stage: 'quick' | 'investigate' | null
  model: string | null
  /** What the escalating pass looked at, in the order it looked. */
  evidence: AutoReviewEvidenceInfoResponse[]
}

export interface AssistantInfoResponse {
  id: string
  name: string
  description: string | null
  avatar: string | null
  system_prompt: string
  provider_id: string | null
  model_id: string | null
  temperature: number | null
  top_p: number | null
  max_tokens: number | null
  is_default: boolean
  sort_order: number
  created_at: number
  updated_at: number
  context_limit: number
  compact_keep_recent: number
  enabled_tools: string[] | null
  thinking_enabled: boolean
  thinking_budget: number | null
  tool_preset_id: string | null
  auto_compact_enabled: boolean
}

/** Effort tiers a model can advertise, ascending. Mirrors EFFORT_LADDER in the Rust catalog. */
export type ThinkingEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ThinkingLevel = 'default' | 'off' | ThinkingEffort

/** Stored conversation values never contain the UI-only inheritance sentinel. */
export type StoredThinkingLevel = Exclude<ThinkingLevel, 'default'>

/** Provider-specific wire shape used to enable or disable model reasoning. */
export type ThinkingStyle = 'none' | 'effort_only' | 'budget' | 'adaptive' | 'always_on' | 'toggle_off'

export type ProviderApiFormat = 'chat_completions' | 'responses' | 'gemini_generate_content' | 'gemma_tool'
export type ProviderCredentialKind = 'api_key' | 'codex_cli' | 'chatgpt_oauth'
export type ProviderTransportProfile = 'standard' | 'chatgpt_codex'
export type ProviderType = 'openai' | 'anthropic' | 'deepseek' | 'xai' | 'google'

export interface ProviderInfoResponse {
  id: string
  name: string
  provider_type: ProviderType
  base_url: string
  is_enabled: boolean
  sort_order: number
  created_at: number
  updated_at: number
  api_format: ProviderApiFormat
  /**
   * Which entry in the shipped vendor catalog this row is an instance of, or
   * null for one the catalog does not describe.
   *
   * Display and prefill only — it never decides how a request is sent, which is
   * `provider_type` plus `api_format`. Null is ordinary: hand-made providers and
   * anything pointing at a relay have it.
   */
  catalog_id: string | null
  /**
   * Where the credential comes from: `api_key`, or one of the ChatGPT logins.
   *
   * Not an input to which adapter runs — two ways of signing in to ChatGPT
   * produce the same token on the same wire.
   */
  credential_kind: ProviderCredentialKind
  /**
   * How requests are shaped, and the third input to picking an adapter beside
   * `provider_type` and `api_format`. It exists because the format alone cannot
   * separate OpenAI's API from ChatGPT's Codex backend — both are `responses`.
   */
  transport_profile: ProviderTransportProfile
}

/**
 * One vendor in the shipped catalog — the data behind "which service is this?".
 *
 * Mirrors `provider::catalog::CatalogEntry`. It describes and prefills; nothing
 * here decides how a request is sent.
 */
export interface ProviderCatalogWebsitesInfoResponse {
  official: string | null
  api_key: string | null
  docs: string | null
  models: string | null
}

export interface ProviderCatalogModelGroupInfoResponse {
  family: string
  ids: string[]
}

export interface ProviderCatalogEntryInfoResponse {
  id: string
  provider_type: ProviderType
  name: string
  icon: string
  balance: boolean
  websites: ProviderCatalogWebsitesInfoResponse
  auth: ProviderCatalogAuthOptionInfoResponse[]
  models: ProviderCatalogModelGroupInfoResponse[]
}

export type ProviderCatalogEntryListResponse = ProviderCatalogEntryInfoResponse[]

/**
 * A way of signing in, carrying the endpoint and dialect that come with it.
 *
 * Those live here rather than on the entry because they belong to the login:
 * OpenAI's API and ChatGPT's Codex backend are both `responses` and differ in
 * base URL, so one address per dialect cannot describe both.
 */
/**
 * Which ChatGPT account a Codex-backed provider is signed in as.
 *
 * Carries no token material. `codex_home` is shown because a GUI process need
 * not inherit a terminal's environment, which is the usual reason for "I am
 * logged in but the app says I am not".
 */
export interface CodexAuthStatusResponse {
  logged_in: boolean
  email: string | null
  plan: string | null
  /** Where the login actually lives. */
  storage: 'file' | 'keyring' | null
  codex_home: string | null
  /** Present when something is wrong, phrased as what to do about it. */
  problem: string | null
}

export interface ProviderCatalogAuthOptionInfoResponse {
  id: string
  credential_kind: ProviderCredentialKind
  transport_profile: ProviderTransportProfile
  /** A single entry means the dialect is not a choice, so no selector is drawn. */
  api_formats: ProviderApiFormat[]
  default_base_url: Partial<Record<ProviderApiFormat, string>>
}

export interface ProviderModelInfoResponse {
  id: string
  name: string
}

export type ProviderModelListResponse = ProviderModelInfoResponse[]

export type McpTransport = 'stdio' | 'streamablehttp'

export interface McpServerInfoResponse {
  id: string
  name: string
  transport_type: McpTransport
  command: string | null
  args: string[] | null
  env: Record<string, string> | null
  url: string | null
  headers: Record<string, string> | null
  is_enabled: boolean
  sort_order: number
  created_at: number
  updated_at: number
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface McpServerToolInfoResponse {
  server_id: string
  server_name: string
  qualified_name: string
  name: string
  description: string
  input_schema: JsonValue
}

export type McpServerToolListResponse = McpServerToolInfoResponse[]

/** Reported for servers the backend currently has an entry for. A server that
 *  is connected but exposes no tools is still connected — which is exactly what
 *  guessing from the tool list got wrong. */
export interface McpConnectionStatusInfoResponse {
  server_id: string
  state: 'disconnected' | 'connecting' | 'connected'
  tool_count: number
}

export type McpConnectionStatusListResponse = McpConnectionStatusInfoResponse[]

export interface McpToolInfoResponse {
  name: string
  description: string
  source: 'builtin' | 'mcp' | 'onebot'
  server_name: string | null
  admin_only: boolean | null
  needs_approval: boolean | null
  scope: 'any' | 'group' | 'private' | null
}

export type McpToolListResponse = McpToolInfoResponse[]

export interface SafRootInfoResponse {
  uri: string
  display_name: string
  virtual_prefix: string
}

export type SafRootListResponse = SafRootInfoResponse[]

export interface WindowInsetsInfoResponse {
  top: number
  right: number
  bottom: number
  left: number
  imeBottom: number
}

export type PlatformInfoResponse = 'android' | 'windows' | 'macos' | 'linux' | 'ios'

/** The local hook endpoint configuration returned by the host. */
export interface HookConfigInfoResponse {
  enabled: boolean
  host: string
  port: number
  /** Minted by the backend on first save; the settings page only displays it. */
  token: string | null
  /** `"<provider_id>:<model_id>"`. Required — there is no sensible default for
   *  "which model reviews plans". */
  review_model: string | null
  /** Supplies temperature and thinking; the persona is always the review
   *  prompt. Null means the default assistant. */
  assistant_id: string | null
  timeout_secs: number
  /** Rounds before the gate stops blocking. `0` disables that limit — the
   *  stagnation check still ends a review that stops making progress. */
  max_rounds: number
}

/** Complete hook endpoint settings accepted by the host. Nullable keys remain required. */
export interface HookConfigUpdateRequest {
  enabled: boolean
  host: string
  port: number
  token: string | null
  review_model: string | null
  assistant_id: string | null
  timeout_secs: number
  max_rounds: number
}

export interface HookStatusInfoResponse {
  enabled: boolean
  running: boolean
  host: string
  port: number
  /** Where the plugin looks for us. Shown so a stuck setup can be diagnosed. */
  handshake_path: string | null
}

/** Remote-listener configuration returned by the host. */
export interface ListenConfigInfoResponse {
  enabled: boolean
  /** `0.0.0.0` by default: a remote access server on loopback is reachable only
   *  by the machine that already has the app open. */
  host: string
  port: number
  /** Minted by the backend on first enable; the settings page only displays it.
   *  The backend refuses to bind a non-loopback address with a token shorter
   *  than 16 characters, which is why nothing here lets one be typed. */
  token: string | null
}

/** Complete remote-listener settings accepted by the host. Nullable keys remain required. */
export interface ListenConfigUpdateRequest {
  enabled: boolean
  host: string
  port: number
  token: string | null
}

export interface ListenStatusResponse {
  enabled: boolean
  running: boolean
  host: string
  port: number
  /** Live websocket connections. The one number that says whether the phone on
   *  the sofa is actually attached, which `running` does not. */
  connections: number
}

export interface OneBotStatusInfoResponse {
  enabled: boolean
  running: boolean
  connected_clients: number
  host: string
  port: number
}

export interface VoiceSendReadinessInfoResponse {
  enabled: boolean
  has_model: boolean
  has_reference_id: boolean
  has_api_key: boolean
  ready: boolean
}

/** OneBot configuration returned by the host. */
export interface OneBotConfigInfoResponse {
  enabled: boolean
  host: string
  port: number
  access_token: string | null
  assistant_id: string | null
  admin_users: number[]
  ack_emoji_id: string
  balance_alert_threshold: DecimalString | null
  voice_capture_sessions: string[]
  voice_send_enabled: boolean
  voice_send_groups: string[]
  voice_tts_model: string
  voice_tts_reference_id: string
}

/** Complete OneBot settings accepted by the host. Nullable keys remain required. */
export interface OneBotConfigUpdateRequest {
  enabled: boolean
  host: string
  port: number
  access_token: string | null
  assistant_id: string | null
  admin_users: number[]
  ack_emoji_id: string
  balance_alert_threshold: DecimalString | null
  voice_capture_sessions: string[]
  voice_send_enabled: boolean
  voice_send_groups: string[]
  voice_tts_model: string
  voice_tts_reference_id: string
}

export type EmojiPackKind = 'manual' | 'onebot'
export type EmojiSource = 'local' | 'onebot_face' | 'onebot_mface' | 'onebot_image'
export type EmojiSemanticStatus = 'pending' | 'suggested' | 'confirmed'

export interface EmojiPackInfoResponse {
  id: string
  name: string
  description: string | null
  cover_image: string | null
  is_builtin: boolean
  sort_order: number
  created_at: number
  updated_at: number
  kind: EmojiPackKind
  source_account_id: string | null
}

export interface EmojiInfoResponse {
  id: string
  pack_id: string
  name: string
  tags: string | null
  file_name: string
  file_format: string
  sort_order: number
  created_at: number
  source: EmojiSource
  source_key: string | null
  semantic_status: EmojiSemanticStatus
  suggested_name: string | null
  suggested_tags: string | null
  file_size: number
  seen_count: number
  last_seen_at: number | null
}

export interface StickerContentPart {
  type: 'sticker'
  sticker_id: string
  name?: string
}

export interface PromptTemplateInfoResponse {
  id: string
  name: string
  description: string | null
  category: string
  template_text: string
  is_builtin: boolean
  sort_order: number
  created_at: number
  updated_at: number
}

export interface TemplateVariableInfoResponse {
  name: string
  description_en: string
  description_zh: string
}

export type TemplateVariableListResponse = TemplateVariableInfoResponse[]

export interface ToolCategoryInfoResponse {
  id: string
  name: string
  description: string | null
  icon: string | null
  sort_order: number
  created_at: number
}

export interface CustomToolInfoResponse {
  id: string
  name: string
  description: string
  category_id: string | null
  parameters_schema: Record<string, unknown>
  command: string
  args_template: string | null
  working_directory: string | null
  timeout_ms: number | null
  permission: ToolPermission
  is_enabled: boolean
  sort_order: number
  created_at: number
  updated_at: number
}

export interface ToolPresetInfoResponse {
  id: string
  name: string
  description: string | null
  icon: string | null
  tool_names: string[]
  is_builtin: boolean
  sort_order: number
  created_at: number
  updated_at: number
}

export type SkillSource = 'official' | 'user' | 'assistant' | 'imported'

/** Index row for a skill directory on disk. The SKILL.md body is not part of
 *  the row; fetch it separately with `getSkillBody`. Two name pairs on purpose:
 *  `display_*` is what the user reads, `llm_*` is what reaches the model. */
export interface SkillInfoResponse {
  dir_name: string
  llm_name: string
  llm_description: string
  display_name: string
  display_description: string | null
  source: SkillSource
  is_enabled: boolean
  is_builtin: boolean
  mtime_hash: string | null
  created_at: number
  updated_at: number
}

/** Binding scope for a skill. Only `global` accepts a null anchor id. */
export type SkillLayer = 'global' | 'project' | 'assistant'

export interface ProviderCapabilitiesInfoResponse {
  supports_tools: boolean
  supports_streaming_tools: boolean
  supports_thinking: boolean
  /** False for always-thinking models such as Gemini 3.x. */
  supports_thinking_off: boolean
  supports_images: boolean
  max_context_tokens: number | null
  max_output_tokens: number | null
  supports_pdf: boolean
  supports_temperature: boolean
  supports_top_p: boolean
  max_temperature: number | null
  thinking_style: ThinkingStyle
  /** Effort tiers this model accepts, ascending. Empty means no effort control. */
  supported_efforts: ThinkingEffort[]
  default_effort: ThinkingEffort | null
  supports_fast: boolean
  supports_verbosity: boolean
  default_verbosity: CapabilityVerbosity | null
  /**
   * Provider-side tools this model *can* be asked to run, by wire type name.
   * What it will run is `ModelConfig.server_tools`, narrowed against this.
   * Empty on chat-completions, where no such thing exists.
   */
  server_tools: ServerToolKind[]
}

export type CapabilityVerbosity = 'low' | 'medium' | 'high'

/** Provider-side tools Meridian knows how to request. This is not an extension point. */
export type ServerToolKind = 'web_search' | 'x_search' | 'code_execution'

/** Closed patch shape persisted as JSON text but carried over IPC as an object. */
export interface ProviderCapabilityOverrides {
  supports_tools?: boolean
  supports_streaming_tools?: boolean
  supports_thinking?: boolean
  supports_thinking_off?: boolean
  supports_images?: boolean
  supports_pdf?: boolean
  supports_temperature?: boolean
  supports_top_p?: boolean
  supports_fast?: boolean
  supports_verbosity?: boolean
  thinking_style?: ThinkingStyle
  supported_efforts?: ThinkingEffort[]
  server_tools?: ServerToolKind[]
  default_effort?: ThinkingEffort | null
  default_verbosity?: CapabilityVerbosity | null
  max_context_tokens?: number | null
  max_output_tokens?: number | null
  max_temperature?: number | null
}

export interface ModelConfigInfoResponse {
  id: string
  provider_id: string
  model_id: string
  display_name: string | null
  context_window: number
  compact_threshold: number
  max_output_tokens: number | null
  input_price: DecimalString | null
  output_price: DecimalString | null
  /** What a cache *read* costs. Blank means "priced like input". */
  cache_read_price: DecimalString | null
  /**
   * What a cache *write* costs, when it costs more than input. Anthropic
   * charges 1.25x for a five-minute entry and 2x for an hour; nobody else
   * charges a premium, which is what null means.
   */
  cache_write_price: DecimalString | null
  created_at: number
  updated_at: number
  /** Strict patch over the built-in catalog; malformed or unknown persisted fields fail the read. */
  capability_overrides: ProviderCapabilityOverrides | null
  /**
   * Rates that take over above a prompt size. An empty array means one price at
   * every size. Crossing a threshold re-prices the *whole* request, not the
   * excess.
   */
  pricing_tiers: PriceTier[]
  /**
   * Provider-side tools switched on for this model. Narrowed against the
   * model's capabilities at turn time, so a
   * name here cannot outlive the support it refers to.
   */
  server_tools: ServerToolKind[] | null
  /**
   * What one provider-side tool invocation costs, per **thousand** calls — the
   * unit the upstreams publish it in. Null means nobody has said, which is not
   * zero: a searching turn priced at nothing is under-reported, not free.
   */
  server_tool_price: DecimalString | null
}

/**
 * One run of a provider-side tool, as the stream reports it.
 *
 * Announced twice — starting and finished — under the same `id`, because the
 * query and the sources only exist on the second. A card is revised, not
 * appended.
 */
export interface ServerToolCall {
  id: string
  name: string
  /** What it was called with, as a JSON object string. Shaped like a function
   *  call's arguments so a card renders it the same way. */
  arguments: string | null
  sources: string[]
  completed: boolean
}

/** One currency's worth of credit on a provider account. */
export interface ProviderBalanceAccountInfoResponse {
  currency: string
  /** What can actually be spent — the figure worth acting on. */
  total_balance: DecimalString
  /** Promotional credit, which typically expires. */
  granted_balance: DecimalString | null
  topped_up_balance: DecimalString | null
}

/**
 * What is left on a provider account, for the few upstreams that publish it.
 *
 * `is_available` is the upstream's own verdict and is kept apart from the
 * numbers on purpose: it accounts for postpaid arrangements, expired grants and
 * holds, none of which a total shows.
 */
export interface ProviderBalanceInfoResponse {
  is_available: boolean
  accounts: ProviderBalanceAccountInfoResponse[]
}

/**
 * A rate set that takes over once the prompt is large enough.
 *
 * The threshold counts the whole prompt, cached part included, and crossing it
 * re-prices the entire request rather than the part above it — xAI, Gemini and
 * OpenAI all do this. Reading it as a tax bracket understates a long request by
 * nearly the base rate.
 */
export interface PriceTier {
  min_prompt_tokens: number
  input_price: DecimalString
  output_price: DecimalString
  cache_read_price: DecimalString | null
  cache_write_price: DecimalString | null
}

export interface ModelConfigUpsertRequest {
  provider_id: string
  model_id: string
  display_name: string | null
  context_window: number
  compact_threshold: number
  max_output_tokens: number | null
  input_price: DecimalString | null
  output_price: DecimalString | null
  cache_read_price: DecimalString | null
  cache_write_price: DecimalString | null
  capability_overrides: ProviderCapabilityOverrides | null
  pricing_tiers: PriceTier[]
  server_tools: ServerToolKind[] | null
  server_tool_price: DecimalString | null
}

export interface ModelConfigReadRequest {
  providerId: string
  modelId: string
}

/**
 * A usage report, grouped by one thing.
 *
 * Read out of the audit log, which outlives the conversations it describes — so
 * a row here can name something that no longer exists, and that is the point
 * rather than a bug. See `src-tauri/src/db/ops/usage.rs`.
 */
export type UsageDimension =
  | 'total'
  | 'provider'
  | 'model'
  | 'bot'
  | 'source'
  | 'conversation'
  | 'day'
  | 'hour'
  /** Answering the user, versus reviewing whether a tool call was allowed to
   *  happen. Its keys are roles rather than ids, so they have no `label` from
   *  the backend — the caller names them. */
  | 'kind'

export interface UsageReportRequest {
  dimension: UsageDimension
  sinceMs: number | null
  untilMs: number | null
  origin: TurnOrigin | null
  conversationId: string | null
}

export type TurnOrigin =
  'desktop' | 'onebot' | 'sub_agent' | 'plan_review' | 'impl_review' | 'claude_code' | 'user_shell'

export type ServiceKey = 'TAVILY' | 'ZHIPU_SEARCH' | 'FISH_AUDIO'

export interface ServiceKeyUpdateRequest {
  service: ServiceKey
  key: string
}

export interface UsageBucketInfoResponse {
  key: string
  /** `null` once the thing `key` names has been deleted. */
  label: string | null
  /** Replies. Only assistant rows carry tokens, so questions are not counted. */
  messages: number
  /** Replies included in Meridian's locally priced amount. */
  metered_messages: number
  /** Replies covered by a provider subscription rather than per-request pricing. */
  subscription_messages: number
  /** Replies whose cost is settled outside Meridian. */
  external_messages: number
  /** Replies where the provider supplied none of the token usage fields. */
  missing_token_usage_messages: number
  /** Replies missing either input or output token usage. */
  incomplete_token_usage_messages: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  /** Already-priced uncached prompt cost, computed by the backend. */
  input_cost: DecimalString
  /** Already-priced completion cost, computed by the backend. */
  output_cost: DecimalString
  /** Already-priced cache read/write cost, computed by the backend. */
  cache_cost: DecimalString
  /** Already-priced provider-hosted tool cost, computed by the backend. */
  tool_cost: DecimalString
  total_cost: DecimalString
  /** Replies with an unknown token component (usage or price). */
  unpriced_token_messages: number
  /** Replies with provider-tool calls whose rate is unknown. */
  unpriced_tool_messages: number
  /** Replies priced from today's token rates because their historical snapshot is absent. */
  estimated_token_messages: number
  /** Replies priced from today's tool rate because their historical snapshot is absent. */
  estimated_tool_messages: number
  /** Union of the two component estimate counts above. */
  estimated_messages: number
  /**
   * Replies with incomplete metered usage or pricing. Known counts and priced
   * components remain above; unknown parts are absent, so a view that shows
   * `cost` without this state is claiming a complete bill it cannot support.
   */
  unpriced_messages: number
}

export interface ContextInfoResponse {
  estimated_tokens: number
  context_limit: number
  compact_threshold: number
  auto_compact_enabled: boolean
  circuit_breaker_state: CompactCircuitBreakerState
  message_count: number
  /** Whose window this is. A percentage on its own cannot say, and a delegated
   *  run routinely runs on a different model from the conversation that started
   *  it — so the same fraction means a different number of tokens. */
  model: string
  /** `explore` | `agent` when this conversation is a delegated run. Null for
   *  an ordinary one. */
  agent_kind: ConversationAgentKind | null
}

export type CompactCircuitBreakerState = 'closed' | 'open' | 'half-open'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
export type LogRecordLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'

/** Where a page request resumes. */
export interface LogCursorRequest {
  fileIndex: number
  byteOffset: number
}

/** Where a response page stopped, so the next one can resume exactly there. */
export interface LogCursorInfoResponse {
  fileIndex: number
  byteOffset: number
}

/** One line of the application log, already parsed and redacted by the backend. */
export interface LogEntryInfoResponse {
  /** RFC3339, UTC. */
  ts: string
  tsMs: number
  level: LogRecordLevel
  /** Tracing target, e.g. "meridian_lib::provider::openai_compat". */
  target: string
  msg: string
  /** Fields the event itself carried. */
  fields: Record<string, unknown>
  /** Enclosing span names, outermost first. */
  spans: string[]
  /** Fields inherited from those spans, such as conversation_id. */
  spanFields: Record<string, unknown>
  file: string | null
  line: number | null
  cursor: LogCursorInfoResponse
}

export interface LogPageResponse {
  entries: LogEntryInfoResponse[]
  /** Null once the scan reached the oldest available record. */
  nextCursor: LogCursorInfoResponse | null
  /** The scan stopped on its size budget, so older matches may exist. */
  scanTruncated: boolean
  filesScanned: string[]
}

export interface LogQueryRequest {
  minLevel?: LogLevel | null
  limit?: number | null
  contains?: string | null
  targetPrefix?: string | null
  conversationId?: string | null
  sinceTsMs?: number | null
  untilTsMs?: number | null
  cursor?: LogCursorRequest | null
}

export interface LogLevelUpdateRequest {
  level: LogLevel
}

export interface LogExportRequest {
  outputPath: string
}

export interface LogExportResponse {
  bytesWritten: number
}

/**
 * The host's own description of itself, for Settings → About.
 *
 * "Host" is load-bearing in remote mode: the turns run there, so these are the
 * numbers worth quoting in a bug report — not the phone's.
 */
export interface AppInfoResponse {
  version: string
  tauriVersion: string
  os: PlatformInfoResponse
  arch: string
  dataDir: string
}

export interface LogFileInfoResponse {
  name: string
  size: number
}

export interface LogSettingsResponse {
  level: LogLevel
  levels: LogLevel[]
  directory: string
  maxFileBytes: number
  maxFiles: number
  /** False when the log file could not be opened; the panel says so. */
  available: boolean
}

export type ToolOutcome = 'success' | 'denied' | 'error'

export type ChatStopReason =
  'end_turn' | 'error' | 'loop_detected' | 'cancelled' | 'max_tokens' | 'max_turn_requests' | 'refusal'

/** The complete, closed contract carried by the `chat-stream` channel. */
export type ChatStreamEvent =
  | { type: 'text'; content: string; message_id: string; conversation_id: string }
  | { type: 'reasoning'; content: string; message_id: string; conversation_id: string }
  | { type: 'message_start'; message_id: string; turn_id: string; conversation_id: string }
  | { type: 'user_message'; content: string; message_id: string; conversation_id: string }
  | {
      type: 'retry'
      attempt: number
      max_attempts: number
      delay_ms: number
      message_id: string
      conversation_id: string
    }
  | { type: 'reset'; message_id: string; conversation_id: string }
  | { type: 'server_tool'; message_id: string; conversation_id: string; call: ServerToolCall }
  | {
      type: 'tool_call'
      call_id: string
      tool_name: string
      arguments: string
      message_id: string
      conversation_id: string
    }
  | {
      type: 'tool_call_revised'
      call_id: string
      tool_name: string
      arguments: string
      message_id: string
      conversation_id: string
    }
  | {
      type: 'tool_result'
      call_id: string
      result: string
      outcome: ToolOutcome
      message_id: string
      conversation_id: string
    }
  | {
      type: 'tool_approval_req'
      approval_id: string
      call_id: string
      tool_name: string
      arguments: string
      message_id: string
      conversation_id: string
      delegation: { parent_call_id: string; sub_conversation_id: string } | null
      retry: { reason: string; origin_call_id: string } | null
    }
  | {
      type: 'tool_approval_expired'
      approval_id: string
      call_id: string
      tool_name: string
      message_id: string
      conversation_id: string
    }
  | {
      type: 'sub_agent_started'
      conversation_id: string
      message_id: string
      call_id: string
      sub_conversation_id: string
      spawned_turn_id: string
      kind: SubAgentKind
      description: string
    }
  | {
      type: 'auto_review'
      conversation_id: string
      turn_id: string
      message_id: string
      call_id: string
      tool_name: string
      verdict: AutoReviewVerdictInfoResponse
    }
  | { type: 'acp_config'; conversation_id: string; config_options: AcpConfigOptionInfoResponse[] }
  | { type: 'acp_usage'; conversation_id: string; used: number; size: number }
  | { type: 'acp_notice'; conversation_id: string; notice: AcpSessionNoticeInfoResponse }
  | {
      type: 'tool_call_diff'
      conversation_id: string
      message_id: string
      call_id: string
      diffs: ToolCallDiffInfoResponse[]
    }
  | {
      type: 'redaction_notice'
      conversation_id: string
      turn_id: string
      redacted_count: number
      rules: string[]
    }
  | {
      type: 'stop'
      reason: ChatStopReason
      message_id: string | null
      turn_id: string
      conversation_id: string
      input_tokens: number | null
      output_tokens: number | null
    }
