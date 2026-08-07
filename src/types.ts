export interface Project {
  id: string
  name: string
  path: string | null
  source_type: string
  source_id: string | null
  assistant_id: string | null
  description: string | null
  created_at: number
  updated_at: number
}

/** Scope/origin/visibility values come from the `memory_enums` command rather
 *  than literal unions here, so the front end cannot drift from the Rust enums. */
export interface Memory {
  id: string
  scope_type: string
  scope_id: string
  key: string
  content: string
  memory_type: string
  subject_scope_id: string | null
  origin: string
  visibility: string
  source_session_id: string | null
  deleted_at: number | null
  deleted_by: string | null
  created_at: number
  updated_at: number
}

export type TodoItemStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  id: string
  list_id: string
  content: string
  /** Present-continuous phrasing, shown while this step is the one running. */
  active_form: string
  status: TodoItemStatus
  sort_order: number
  created_at: number
}

export interface TodoList {
  id: string
  conversation_id: string
  title: string
  status: 'in_progress' | 'completed'
  created_at: number
  updated_at: number
}

export interface TodoListView {
  list: TodoList
  items: TodoItem[]
}

export interface MemorySubject {
  scope_id: string
  display_name: string | null
  last_seen_at: number
  created_at: number
  is_protected: number
  is_pinned: number
  opted_out: number
}

export interface MemoryEnums {
  scopes: string[]
  origins: string[]
  visibilities: string[]
  memory_types: string[]
}

export interface Conversation {
  id: string
  title: string | null
  assistant_id: string | null
  is_pinned: number
  is_archived: number
  message_count: number
  created_at: number
  updated_at: number
  project_id: string | null
  compact_cursor: number | null
  /** Per-conversation reasoning tier; null means inherit the assistant default. */
  thinking_level: string | null
  fast_mode: number
  /** Collaboration mode; null is the default (work) mode. */
  mode: string | null
  /** Leaf the active path ends at. Null falls back to the newest message. */
  head_message_id?: string | null
  /**
   * Standing approval for ordinary edits inside the project. What it widens is
   * bounded in the backend, not here: never outside the project, never anything
   * irreversible, never a path that makes code run later.
   */
  accept_edits: number
}

/** A step on the active path that was answered more than once. */
export interface BranchPoint {
  /** The version currently on the path. */
  message_id: string
  /** 0-based position among `sibling_ids`. */
  index: number
  total: number
  /** Every version, oldest first, so paging is stable across reloads. */
  sibling_ids: string[]
}

/** One snapshot of a conversation: the active path plus where it can be paged.
 *  Returned whole so the two can never disagree on screen. */
export interface MessageTree {
  messages: Message[]
  head_message_id: string | null
  branches: BranchPoint[]
}

/** Ids must match `agent::modes` on the Rust side. */
export type ChatMode = 'work' | 'plan'

export interface ToolCallDisplay {
  call_id: string
  tool_name: string
  arguments: string
  /** `orphaned` is a call the transcript shows as unanswered while nothing is
   *  waiting for a decision on it — its turn died. In the database it looks
   *  exactly like a pending call, so only the live registry tells them apart,
   *  and only a pending one gets buttons. */
  status: 'pending' | 'approved' | 'denied' | 'running' | 'completed' | 'error' | 'orphaned'
  result?: string
  /** What the buttons answer with while this call is `pending`. Minted by the
   *  backend per approval rather than taken from the provider's call id, which
   *  some OpenAI-compatible gateways reuse. A pending call without one cannot
   *  be answered, and is shown as `orphaned` rather than falling back to
   *  `call_id`. */
  approval_id?: string
  /** Present exactly when this is a sandbox-blocked call asking to be retried
   *  without the sandbox. The retry reuses the original call id. */
  retry_reason?: string
}

/** A tool call the backend is still holding a turn open for. Recovered on load,
 *  since the streamed event that first announced it is gone by then. */
export interface PendingApprovalInfo {
  approval_id: string
  assistant_message_id: string
  provider_call_id: string
  tool_name: string
  retry_reason?: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; data: ToolCallDisplay }

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface VoiceModelStatus {
  installed: boolean
  path: string | null
  size_bytes: number
  downloading: boolean
}

export interface VoiceTranscript {
  status: 'ok' | 'too_short' | 'empty'
  text: string
  duration_ms: number
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  provider_id: string | null
  model_id: string | null
  input_tokens: number | null
  output_tokens: number | null
  tool_calls: string | null
  tool_call_id: string | null
  sort_order: number
  created_at: number
  reasoning_content: string | null
  rating: number | null
  schema_version: number
  is_compact_summary: number
  /** The message this one answers or follows. Siblings under one parent are
   *  alternative versions of the same step. Null marks a root. */
  parent_id?: string | null
  /** How the message was produced: null for typed, 'voice' for speech input. */
  source?: string | null
  /** Only on compaction summaries: the first message the summary stands in
   *  front of. */
  compact_anchor_id?: string | null
  _blocks?: ContentBlock[]
}

export interface Assistant {
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
  is_default: number
  sort_order: number
  created_at: number
  updated_at: number
  context_limit: number
  compact_keep_recent: number
  enabled_tools: string | null
  thinking_enabled: number
  thinking_budget: number | null
  tool_preset_id: string | null
  auto_compact_enabled: number
}

/** Effort tiers a model can advertise, ascending. Mirrors EFFORT_LADDER in the Rust catalog. */
export type ThinkingEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ThinkingLevel = 'default' | 'off' | ThinkingEffort

export interface Provider {
  id: string
  name: string
  provider_type: string
  base_url: string
  is_enabled: number
  sort_order: number
  created_at: number
  updated_at: number
  api_format: string
}

export interface ModelInfo {
  id: string
  name: string
}

export interface McpServer {
  id: string
  name: string
  transport_type: string
  command: string | null
  args: string | null
  env: string | null
  url: string | null
  headers: string | null
  is_enabled: number
  sort_order: number
  created_at: number
  updated_at: number
}

export interface McpToolDef {
  server_id: string
  server_name: string
  qualified_name: string
  name: string
  description: string
}

export interface ToolInfo {
  name: string
  description: string
  source: 'builtin' | 'mcp' | 'onebot'
  server_name?: string
  admin_only?: boolean
  needs_approval?: boolean
  scope?: 'any' | 'group' | 'private'
}

export interface SafRootEntry {
  uri: string
  display_name: string
  virtual_prefix: string
}

export interface EmojiPack {
  id: string
  name: string
  description: string | null
  cover_image: string | null
  is_builtin: number
  sort_order: number
  created_at: number
  updated_at: number
}

export interface Emoji {
  id: string
  pack_id: string
  name: string
  tags: string | null
  file_name: string
  file_format: string
  sort_order: number
  created_at: number
}

export interface PromptTemplate {
  id: string
  name: string
  description: string | null
  category: string
  template_text: string
  is_builtin: number
  sort_order: number
  created_at: number
  updated_at: number
}

export interface TemplateVariable {
  name: string
  description_en: string
  description_zh: string
}

export interface ToolCategory {
  id: string
  name: string
  description: string | null
  icon: string | null
  sort_order: number
  created_at: number
}

export interface CustomTool {
  id: string
  name: string
  description: string
  category_id: string | null
  parameters_schema: string
  command: string
  args_template: string | null
  working_directory: string | null
  timeout_ms: number | null
  permission: string
  is_enabled: number
  sort_order: number
  created_at: number
  updated_at: number
}

export interface ToolPreset {
  id: string
  name: string
  description: string | null
  icon: string | null
  tool_names: string
  is_builtin: number
  sort_order: number
  created_at: number
  updated_at: number
}

/** Index row for a skill directory on disk. The SKILL.md body is not part of
 *  the row; fetch it separately with `getSkillBody`. Two name pairs on purpose:
 *  `display_*` is what the user reads, `llm_*` is what reaches the model. */
export interface Skill {
  dir_name: string
  llm_name: string
  llm_description: string
  display_name: string
  display_description: string | null
  source: 'official' | 'user' | 'assistant' | 'imported'
  is_enabled: number
  is_builtin: number
  mtime_hash: string | null
  created_at: number
  updated_at: number
}

/** Binding scope for a skill. Only `global` accepts a null anchor id. */
export type SkillLayer = 'global' | 'project' | 'assistant'

export interface ProviderCapabilities {
  supports_tools: boolean
  supports_streaming_tools: boolean
  supports_thinking: boolean
  supports_images: boolean
  max_context_tokens: number | null
  max_output_tokens: number | null
  supports_pdf?: boolean
  supports_temperature?: boolean
  supports_top_p?: boolean
  supports_reasoning_effort?: boolean
  max_temperature?: number | null
  /** Effort tiers this model accepts, ascending. Empty means no effort control. */
  supported_efforts?: ThinkingEffort[]
  default_effort?: ThinkingEffort | null
  supports_fast?: boolean
  supports_verbosity?: boolean
  default_verbosity?: string | null
}

export interface ModelConfig {
  id: string
  provider_id: string
  model_id: string
  display_name: string | null
  context_window: number
  compact_threshold: number
  max_output_tokens: number | null
  input_price: number
  output_price: number
  cache_price: number | null
  created_at: number
  updated_at: number
  /** JSON patch over the built-in catalog; malformed content is ignored. */
  capability_overrides: string | null
}

export interface ModelConfigInput {
  provider_id: string
  model_id: string
  display_name?: string | null
  context_window: number
  compact_threshold: number
  max_output_tokens?: number | null
  input_price: number
  output_price: number
  cache_price?: number | null
  capability_overrides?: string | null
}

export interface ContextInfo {
  estimated_tokens: number
  context_limit: number
  compact_threshold: number
  auto_compact_enabled: boolean
  circuit_breaker_state: string
  message_count: number
}

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE' | 'UNKNOWN'

/** Where a page of log records stopped, so the next one resumes exactly there. */
export interface LogCursor {
  fileIndex: number
  byteOffset: number
}

/** One line of the application log, already parsed and redacted by the backend. */
export interface LogEntry {
  /** RFC3339, UTC. */
  ts: string
  ts_ms: number
  level: LogLevel
  /** Tracing target, e.g. "meridian_lib::provider::openai_compat". */
  target: string
  msg: string
  /** Fields the event itself carried. */
  fields?: Record<string, unknown>
  /** Enclosing span names, outermost first. */
  spans?: string[]
  /** Fields inherited from those spans, such as conversation_id. */
  span_fields?: Record<string, unknown>
  file?: string
  line?: number
  /** Present instead of the parsed fields when the line could not be read. */
  raw?: string
  cursor: LogCursor
}

export interface LogPage {
  entries: LogEntry[]
  /** Null once the scan reached the oldest available record. */
  nextCursor: LogCursor | null
  /** The scan stopped on its size budget, so older matches may exist. */
  scanTruncated: boolean
  filesScanned: string[]
}

export interface LogQuery {
  minLevel?: string
  limit?: number
  contains?: string
  targetPrefix?: string
  conversationId?: string
  sinceTsMs?: number
  untilTsMs?: number
  cursor?: LogCursor | null
}

export interface LogFileInfo {
  name: string
  size: number
}

export interface LogSettings {
  level: string
  levels: string[]
  directory: string
  maxFileBytes: number
  maxFiles: number
  /** False when the log file could not be opened; the panel says so. */
  available: boolean
}

export interface StreamChunk {
  type?: string
  content?: string
  done?: boolean
  reason?: string
  message_id?: string
  conversation_id?: string
  call_id?: string
  tool_name?: string
  arguments?: string
  result?: string
  outcome?: string
  /** Only on `tool_approval_req`. What the answer must be addressed to. */
  approval_id?: string
  /** Set only when this approval is a sandbox-blocked call asking to run
   *  again without the sandbox. Its presence is what marks the escalation. */
  retry_reason?: string
  input_tokens?: number
  output_tokens?: number
}
