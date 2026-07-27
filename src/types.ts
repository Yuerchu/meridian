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

export interface Memory {
  id: string
  project_id: string
  key: string
  content: string
  memory_type: string
  created_at: number
  updated_at: number
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
}

export interface ToolCallDisplay {
  call_id: string
  tool_name: string
  arguments: string
  status: 'pending' | 'approved' | 'denied' | 'running' | 'completed' | 'error'
  result?: string
  // Set while a sandbox-blocked call waits for "retry without sandbox"
  // approval; the approval channel uses this synthetic "<id>:retry" id.
  escalation_call_id?: string
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
  escalation?: boolean
  origin_call_id?: string
  retry_reason?: string
  input_tokens?: number
  output_tokens?: number
}
