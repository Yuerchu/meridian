export interface Project {
  id: string
  name: string
  path: string
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
}

export interface ToolCallDisplay {
  call_id: string
  tool_name: string
  arguments: string
  status: 'pending' | 'approved' | 'denied' | 'running' | 'completed'
  result?: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; data: ToolCallDisplay }

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
}

export type ThinkingLevel = 'default' | 'off' | 'low' | 'medium' | 'high' | 'max'

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
  source: 'builtin' | 'mcp'
  server_name?: string
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

export interface StreamChunk {
  type?: string
  content?: string
  done?: boolean
  message_id?: string
  call_id?: string
  tool_name?: string
  arguments?: string
  result?: string
  input_tokens?: number
  output_tokens?: number
}
