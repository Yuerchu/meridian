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
}

/** The delegated run a `run_agent` call started. */
export interface SubAgentRunDisplay {
  /** Where it is happening. Hidden from the sidebar; reachable only from here. */
  conversation_id: string
  /** The run itself. The card counts steps against this rather than against the
   *  conversation, whose later turns may be a follow-up chat. */
  turn_id: string
  kind?: string
  /** Assistant iterations — how many times the model was asked. From the
   *  snapshot; while the run is live the store's own counter is ahead of it. */
  steps: number
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
export interface TurnRecord {
  id: string
  /** `running` | `done` | `cancelled` | `failed` | `interrupted`. A value from a
   *  later build travels through as written rather than being flattened into
   *  one of these, so treat anything unrecognised as "no opinion". */
  status: string
  /** What it was doing when it last said anything: `streaming` |
   *  `awaiting_approval` | `running_tool` | `compacting`. Written before the
   *  thing it names, so on an interrupted turn this is where it died. */
  phase: string | null
  /** The call `phase` refers to, when it refers to one. */
  phase_tool: string | null
  error: string | null
  started_at: number
  ended_at: number | null
}

/** A conversation as of one instant.
 *
 *  Replaces three parallel requests. Those could interleave with a running turn
 *  — the tree fetched before a tool result landed, the turns after — and the
 *  result was a conversation that was never true at any moment. */
export interface ConversationSnapshot {
  conversation: Conversation
  tree: MessageTree
  turns: TurnRecord[]
  pending_approvals: PendingApprovalInfo[]
  /** Empty for every conversation that has never delegated. */
  sub_agent_runs: SubAgentRunView[]
}

/** One delegated run, as the conversation that started it sees it. */
export interface SubAgentRunView {
  conversation_id: string
  /** Which `run_agent` call started it — both halves, because a provider call
   *  id repeats across the rows of one conversation. */
  spawned_by_message_id: string | null
  spawned_by_call_id: string | null
  spawned_turn_id: string | null
  agent_kind: string | null
  title: string | null
  steps: number
  /** Already folded against the live register, so `running` here means running.
   *  `null` when the delegating turn's row has gone. */
  status: string | null
}

/** A tool call the backend is still holding a turn open for. Recovered on load,
 *  since the streamed event that first announced it is gone by then. */
export interface PendingApprovalInfo {
  approval_id: string
  /** The row the card hangs off *in this conversation*. For a delegated run the
   *  parent names its own `run_agent` row and the sub-agent names the row the
   *  call is on. */
  assistant_message_id: string
  provider_call_id: string
  /** The call this one retries. Set only for sandbox escalations, where it
   *  currently equals `provider_call_id` — a retry reuses the id. */
  origin_call_id?: string
  tool_name: string
  /** What the tool was called with. Sent rather than read off the transcript,
   *  because a delegated call's row is in another conversation. */
  arguments: string
  retry_reason?: string
  /** Shown here, answered elsewhere: this belongs to a delegated run and the
   *  card draws without buttons. */
  bubbled: boolean
  /** Which `run_agent` call to nest the card under. Parent's view only. */
  parent_call_id?: string
  /** Where the delegated run can be watched. Parent's view only. */
  sub_conversation_id?: string
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
  /** `context` is background the backend injected and froze into the history —
   *  memories, mostly. Nobody said it, so it is not drawn: `chat-view` keeps
   *  only user and assistant rows. */
  role: 'user' | 'assistant' | 'system' | 'tool' | 'context'
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
  /** Platform id of whoever sent this, on surfaces where more than one person
   *  can speak. Null on desktop rows, which have a single implicit author, and
   *  on history written before speakers were attributed. The nickname is not
   *  stored alongside it — nicknames change, so they are looked up separately. */
  sender_id?: number | null
  /** Only on compaction summaries: the first message the summary stands in
   *  front of. */
  compact_anchor_id?: string | null
  /** Which run of the agent loop wrote this row. Null on rows written before
   *  turns were recorded, and on compaction summaries, which belong to no one
   *  turn's output. */
  turn_id?: string | null
  /** Only on `role: 'tool'` rows: `success` | `denied` | `error`. Null reads as
   *  success — rows written before the column existed all claimed as much. */
  tool_outcome?: string | null
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

/** Reported for servers the backend currently has an entry for. A server that
 *  is connected but exposes no tools is still connected — which is exactly what
 *  guessing from the tool list got wrong. */
export interface McpConnectionStatus {
  server_id: string
  state: 'disconnected' | 'connecting' | 'connected'
  tool_count: number
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

/** The local endpoint another coding agent's hooks post to. */
export interface HooksConfig {
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

export interface HooksStatus {
  enabled: boolean
  running: boolean
  host: string
  port: number
  /** Where the plugin looks for us. Shown so a stuck setup can be diagnosed. */
  handshake_path: string | null
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
  kind: 'manual' | 'onebot'
  source_account_id: string | null
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
  source: 'local' | 'onebot_face' | 'onebot_mface' | 'onebot_image'
  source_key: string | null
  native_payload: string | null
  semantic_status: 'pending' | 'suggested' | 'confirmed'
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
  /** False for always-thinking models such as Gemini 3.x. */
  supports_thinking_off?: boolean
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
  /** What a cache *read* costs. Blank means "priced like input". */
  cache_price: number | null
  /**
   * What a cache *write* costs, when it costs more than input. Anthropic
   * charges 1.25x for a five-minute entry and 2x for an hour; nobody else
   * charges a premium, which is what null means.
   */
  cache_write_price: number | null
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
  cache_write_price?: number | null
  capability_overrides?: string | null
}

/**
 * A usage report, grouped by one thing.
 *
 * Read out of the audit log, which outlives the conversations it describes — so
 * a row here can name something that no longer exists, and that is the point
 * rather than a bug. See `src-tauri/src/db/ops/usage.rs`.
 */
export type UsageDimension = 'total' | 'provider' | 'model' | 'bot' | 'source' | 'conversation' | 'day' | 'hour'

export interface UsageFilter {
  since_ms?: number | null
  until_ms?: number | null
  /** `desktop` or `onebot`; absent means both. */
  origin?: string | null
}

export interface UsageBucket {
  key: string
  /** `null` once the thing `key` names has been deleted. */
  label: string | null
  /** Replies. Only assistant rows carry tokens, so questions are not counted. */
  messages: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost: number
  /**
   * Replies produced by a model nobody has priced. Their tokens are in the
   * counts above but their cost is in nobody's total, so a view that shows
   * `cost` without showing this is claiming a bill it cannot support.
   */
  unpriced_messages: number
}

export interface ContextInfo {
  estimated_tokens: number
  context_limit: number
  compact_threshold: number
  auto_compact_enabled: boolean
  circuit_breaker_state: string
  message_count: number
  /** Whose window this is. A percentage on its own cannot say, and a delegated
   *  run routinely runs on a different model from the conversation that started
   *  it — so the same fraction means a different number of tokens. */
  model: string
  /** `explore` | `agent` when this conversation is a delegated run. Absent for
   *  an ordinary one. */
  agent_kind?: string
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
  tsMs: number
  level: LogLevel
  /** Tracing target, e.g. "meridian_lib::provider::openai_compat". */
  target: string
  msg: string
  /** Fields the event itself carried. */
  fields?: Record<string, unknown>
  /** Enclosing span names, outermost first. */
  spans?: string[]
  /** Fields inherited from those spans, such as conversation_id. */
  spanFields?: Record<string, unknown>
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
  /** Which run of a turn this belongs to, on `message_start` and `stop`. One
   *  conversation can have events from more than one run reaching it — a QQ
   *  session opened in the desktop UI is the same conversation — and without
   *  this a stop cannot be told apart from any other stop. */
  turn_id?: string
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
  /** The call being retried, alongside `retry_reason`. */
  origin_call_id?: string
  /** On `retry`: which attempt is about to be waited out, and out of how many.
   *  1-based, so the first retry reads as 1 of 3. `delay_ms` is how long the
   *  backoff holds before the request goes again — the event arrives *before*
   *  that wait rather than after it, so a turn is never silent through it.
   *
   *  Deliberately carries no error text. A provider's message can quote the
   *  request back, and this ends up on a screen. */
  attempt?: number
  max_attempts?: number
  delay_ms?: number
  input_tokens?: number
  output_tokens?: number
  /** On `sub_agent_started`, and on a `tool_approval_req` a delegated run
   *  raised: which `run_agent` call on `message_id` this belongs under. Its
   *  presence is what marks the event as being about a sub-agent. */
  parent_call_id?: string
  /** Where the delegated run is happening — the conversation to open when the
   *  card is clicked. */
  sub_conversation_id?: string
  /** The turn that run *is*, which the card counts steps against. Not the
   *  sub-agent conversation's latest turn: that becomes a follow-up chat the
   *  moment anyone types into it. */
  spawned_turn_id?: string
  /** `explore` | `agent`, and the three-to-five words the parent wrote. Only on
   *  `sub_agent_started`. */
  kind?: string
  description?: string
}
