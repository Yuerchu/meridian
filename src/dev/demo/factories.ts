import type {
  ConversationInfoResponse,
  MessageInfoResponse,
  OpenAIToolCall,
  TurnInfoResponse,
  TurnUsageInfoResponse,
} from '@/types'
import { decimal } from '@/lib/decimal'

/**
 * Shared constructors for the fixtures. Every field is spelled out once here so
 * the domain files only say what is different about their row.
 */

/** Minutes before the moment the fixtures were built. Relative rather than
 *  absolute so "2 hours ago" stays "2 hours ago" whenever the page is opened;
 *  a screenshot test that wants a fixed clock freezes `Date` itself. */
export function ago(minutes: number, now: number): number {
  return now - Math.round(minutes * 60_000)
}

export function conversation(
  over: Partial<ConversationInfoResponse> & Pick<ConversationInfoResponse, 'id' | 'title' | 'updated_at'>,
): ConversationInfoResponse {
  return {
    assistant_id: 'demo-assistant-default',
    is_pinned: false,
    is_archived: false,
    message_count: 0,
    created_at: over.updated_at,
    project_id: null,
    thinking_level: null,
    fast_mode: false,
    mode: null,
    head_message_id: null,
    accept_edits: false,
    parent_conversation_id: null,
    spawned_by_message_id: null,
    spawned_by_call_id: null,
    spawned_turn_id: null,
    agent_kind: null,
    agent_provider_id: null,
    agent_model_id: null,
    ...over,
  }
}

export function message(
  over: Partial<MessageInfoResponse> &
    Pick<MessageInfoResponse, 'id' | 'conversation_id' | 'role' | 'content' | 'created_at' | 'parent_id'>,
): MessageInfoResponse {
  const assistant = over.role === 'assistant'
  return {
    provider_id: assistant ? 'demo-provider-anthropic' : null,
    model_id: assistant ? 'claude-sonnet-5' : null,
    input_tokens: assistant ? 1840 : null,
    output_tokens: assistant ? 412 : null,
    cache_read_tokens: assistant ? 1536 : null,
    cache_write_tokens: assistant ? 0 : null,
    provider_name: assistant ? 'Anthropic' : null,
    tool_calls: null,
    tool_call_id: null,
    sort_order: 0,
    reasoning_content: null,
    rating: null,
    is_compact_summary: false,
    source: null,
    sender_id: null,
    compact_anchor_id: null,
    turn_id: null,
    tool_outcome: null,
    auto_review: null,
    tool_diffs: null,
    context_items: [],
    ...over,
  }
}

export function call(id: string, name: string, args: Record<string, unknown>): OpenAIToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

export function usage(input: number, output: number, cacheRead: number, cost: string): TurnUsageInfoResponse {
  return {
    messages: 1,
    missing_token_usage_messages: 0,
    incomplete_token_usage_messages: 0,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: 0,
    server_tool_calls: 0,
    input_cost: decimal('0.0012'),
    output_cost: decimal('0.0061'),
    cache_cost: decimal('0.0005'),
    tool_cost: decimal('0'),
    total_cost: decimal(cost),
    unpriced_token_messages: 0,
    unpriced_input_messages: 0,
    unpriced_output_messages: 0,
    unpriced_cache_messages: 0,
    unpriced_tool_messages: 0,
    estimated_token_messages: 0,
    estimated_tool_messages: 0,
    estimated_messages: 0,
    unpriced_messages: 0,
    metered_messages: 1,
    subscription_messages: 0,
    external_messages: 0,
    pricing_status: 'exact',
  }
}

export function turn(over: Partial<TurnInfoResponse> & Pick<TurnInfoResponse, 'id' | 'started_at'>): TurnInfoResponse {
  return {
    status: 'done',
    phase: null,
    phase_tool: null,
    error: null,
    ended_at: over.started_at + 14_000,
    usage: usage(1840, 412, 1536, '0.0078'),
    ...over,
  }
}

/** A small, recognisable picture for a sticker, as a `data:` URL so no asset
 *  protocol is needed to show it. */
export function stickerSvg(emoji: string, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">` +
    `<rect width="160" height="160" rx="36" fill="hsl(${hue} 80% 88%)"/>` +
    `<text x="80" y="104" font-size="76" text-anchor="middle">${emoji}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
