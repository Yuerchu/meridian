export interface Conversation {
  id: string
  title: string | null
  assistant_id: string | null
  is_pinned: number
  is_archived: number
  message_count: number
  created_at: number
  updated_at: number
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
}

export interface Provider {
  id: string
  name: string
  provider_type: string
  base_url: string
  is_enabled: number
  sort_order: number
  created_at: number
  updated_at: number
}

export interface ModelInfo {
  id: string
  name: string
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
}
