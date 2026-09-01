import { requireKnownKeys, requireRecord } from '@/lib/strict-json'
import type { ChatStreamEvent } from '@/types'

const U32_MAX = 4_294_967_295
const I32_MIN = -2_147_483_648
const I32_MAX = 2_147_483_647
const CHAT_STREAM_EVENT_TYPES = {
  text: true,
  reasoning: true,
  message_start: true,
  user_message: true,
  retry: true,
  reset: true,
  server_tool: true,
  tool_call: true,
  tool_call_revised: true,
  tool_result: true,
  tool_approval_req: true,
  tool_approval_expired: true,
  sub_agent_started: true,
  auto_review: true,
  acp_config: true,
  acp_usage: true,
  stop: true,
} satisfies Record<ChatStreamEvent['type'], true>

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function requireShape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Record<string, unknown> {
  const object = requireKnownKeys(value, [...required, ...optional], label)
  const missing = required.find((key) => !hasOwn(object, key))
  if (missing !== undefined) throw new Error(`${label} is missing required field: ${missing}`)
  return object
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function requireEventType(value: unknown): ChatStreamEvent['type'] {
  const type = requireString(value, 'chat-stream event.type')
  if (!hasOwn(CHAT_STREAM_EVENT_TYPES, type)) throw new Error(`unknown chat-stream event type: ${type}`)
  return type as ChatStreamEvent['type']
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function requireInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${min} through ${max}`)
  }
  return value as number
}

function requireClosedString<const T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function requireStringFields(object: Record<string, unknown>, fields: readonly string[], label: string): void {
  for (const field of fields) requireString(object[field], `${label}.${field}`)
}

function requireNullableString(object: Record<string, unknown>, field: string, label: string): void {
  if (object[field] !== null) requireString(object[field], `${label}.${field}`)
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  for (const [index, item] of value.entries()) requireString(item, `${label}[${index}]`)
  return value as string[]
}

function requireJsonValue(value: unknown, label: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} must be a JSON value`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => requireJsonValue(item, `${label}[${index}]`))
    return
  }
  if (typeof value === 'object') {
    const object = requireRecord(value, label)
    for (const [key, item] of Object.entries(object)) requireJsonValue(item, `${label}.${key}`)
    return
  }
  throw new Error(`${label} must be a JSON value`)
}

function requireServerToolCall(value: unknown, label: string): void {
  const call = requireShape(value, ['id', 'name', 'arguments', 'sources', 'completed'], [], label)
  requireStringFields(call, ['id', 'name'], label)
  if (call.arguments !== null) requireString(call.arguments, `${label}.arguments`)
  requireStringArray(call.sources, `${label}.sources`)
  requireBoolean(call.completed, `${label}.completed`)
}

function requireApprovalDelegation(value: unknown, label: string): void {
  const delegation = requireShape(value, ['parent_call_id', 'sub_conversation_id'], [], label)
  requireStringFields(delegation, ['parent_call_id', 'sub_conversation_id'], label)
}

function requireApprovalRetry(value: unknown, label: string): void {
  const retry = requireShape(value, ['reason', 'origin_call_id'], [], label)
  requireStringFields(retry, ['reason', 'origin_call_id'], label)
}

function requireAutoReviewVerdict(value: unknown, label: string): void {
  const verdict = requireShape(
    value,
    ['outcome', 'risk', 'authorization', 'rationale', 'stage', 'model', 'evidence'],
    [],
    label,
  )
  requireClosedString(verdict.outcome, ['allow', 'deny', 'unreadable'], `${label}.outcome`)
  if (verdict.risk !== null) {
    requireClosedString(verdict.risk, ['low', 'medium', 'high', 'critical'], `${label}.risk`)
  }
  if (verdict.authorization !== null) {
    requireClosedString(verdict.authorization, ['unknown', 'low', 'medium', 'high'], `${label}.authorization`)
  }
  requireNullableString(verdict, 'rationale', label)
  if (verdict.stage !== null) {
    requireClosedString(verdict.stage, ['quick', 'investigate'], `${label}.stage`)
  }
  requireNullableString(verdict, 'model', label)
  if (!Array.isArray(verdict.evidence)) throw new Error(`${label}.evidence must be an array`)
  for (const [index, item] of verdict.evidence.entries()) {
    const evidence = requireShape(item, ['tool', 'arguments'], [], `${label}.evidence[${index}]`)
    requireStringFields(evidence, ['tool', 'arguments'], `${label}.evidence[${index}]`)
  }
}

function requireAcpConfigOptions(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  for (const [index, item] of value.entries()) {
    const optionLabel = `${label}[${index}]`
    const option = requireShape(
      item,
      ['id', 'name', 'description', 'category', 'type', 'currentValue', 'options'],
      [],
      optionLabel,
    )
    requireStringFields(option, ['id', 'name'], optionLabel)
    if (option.description !== null) requireString(option.description, `${optionLabel}.description`)
    if (option.category !== null) requireString(option.category, `${optionLabel}.category`)
    if (option.type !== null) requireString(option.type, `${optionLabel}.type`)
    requireJsonValue(option.currentValue, `${optionLabel}.currentValue`)
    if (!Array.isArray(option.options)) throw new Error(`${optionLabel}.options must be an array`)
    for (const [valueIndex, itemValue] of option.options.entries()) {
      const valueLabel = `${optionLabel}.options[${valueIndex}]`
      const optionValue = requireShape(itemValue, ['value', 'name', 'description'], [], valueLabel)
      requireStringFields(optionValue, ['value', 'name'], valueLabel)
      if (optionValue.description !== null) requireString(optionValue.description, `${valueLabel}.description`)
    }
  }
}

/**
 * Parse the complete first-party `chat-stream` wire contract.
 *
 * The TypeScript union only protects callers that already hold a typed value;
 * Tauri and WebSocket payloads are untrusted `unknown`. Every variant and every
 * nested first-party object is therefore checked here before either transport
 * can hand it to a store.
 */
export function parseChatStreamEvent(value: unknown): ChatStreamEvent {
  const root = requireRecord(value, 'chat-stream event')
  const type = requireEventType(root.type)

  switch (type) {
    case 'text':
    case 'reasoning':
    case 'user_message': {
      const event = requireShape(value, ['type', 'content', 'message_id', 'conversation_id'], [], `${type} event`)
      requireStringFields(event, ['type', 'content', 'message_id', 'conversation_id'], `${type} event`)
      break
    }
    case 'message_start': {
      const event = requireShape(value, ['type', 'message_id', 'turn_id', 'conversation_id'], [], 'message_start event')
      requireStringFields(event, ['type', 'message_id', 'turn_id', 'conversation_id'], 'message_start event')
      break
    }
    case 'retry': {
      const event = requireShape(
        value,
        ['type', 'attempt', 'max_attempts', 'delay_ms', 'message_id', 'conversation_id'],
        [],
        'retry event',
      )
      requireStringFields(event, ['type', 'message_id', 'conversation_id'], 'retry event')
      requireInteger(event.attempt, 0, U32_MAX, 'retry event.attempt')
      requireInteger(event.max_attempts, 0, U32_MAX, 'retry event.max_attempts')
      requireInteger(event.delay_ms, 0, Number.MAX_SAFE_INTEGER, 'retry event.delay_ms')
      break
    }
    case 'reset': {
      const event = requireShape(value, ['type', 'message_id', 'conversation_id'], [], 'reset event')
      requireStringFields(event, ['type', 'message_id', 'conversation_id'], 'reset event')
      break
    }
    case 'server_tool': {
      const event = requireShape(value, ['type', 'message_id', 'conversation_id', 'call'], [], 'server_tool event')
      requireStringFields(event, ['type', 'message_id', 'conversation_id'], 'server_tool event')
      requireServerToolCall(event.call, 'server_tool event.call')
      break
    }
    case 'tool_call':
    case 'tool_call_revised': {
      const event = requireShape(
        value,
        ['type', 'call_id', 'tool_name', 'arguments', 'message_id', 'conversation_id'],
        [],
        `${type} event`,
      )
      requireStringFields(
        event,
        ['type', 'call_id', 'tool_name', 'arguments', 'message_id', 'conversation_id'],
        `${type} event`,
      )
      break
    }
    case 'tool_result': {
      const event = requireShape(
        value,
        ['type', 'call_id', 'result', 'outcome', 'message_id', 'conversation_id'],
        [],
        'tool_result event',
      )
      requireStringFields(event, ['type', 'call_id', 'result', 'message_id', 'conversation_id'], 'tool_result event')
      requireClosedString(event.outcome, ['success', 'denied', 'error'], 'tool_result event.outcome')
      break
    }
    case 'tool_approval_req': {
      const event = requireShape(
        value,
        [
          'type',
          'approval_id',
          'call_id',
          'tool_name',
          'arguments',
          'message_id',
          'conversation_id',
          'delegation',
          'retry',
        ],
        [],
        'tool_approval_req event',
      )
      requireStringFields(
        event,
        ['type', 'approval_id', 'call_id', 'tool_name', 'arguments', 'message_id', 'conversation_id'],
        'tool_approval_req event',
      )
      if (event.delegation !== null) requireApprovalDelegation(event.delegation, 'tool_approval_req event.delegation')
      if (event.retry !== null) requireApprovalRetry(event.retry, 'tool_approval_req event.retry')
      break
    }
    case 'tool_approval_expired': {
      const event = requireShape(
        value,
        ['type', 'approval_id', 'call_id', 'tool_name', 'message_id', 'conversation_id'],
        [],
        'tool_approval_expired event',
      )
      requireStringFields(
        event,
        ['type', 'approval_id', 'call_id', 'tool_name', 'message_id', 'conversation_id'],
        'tool_approval_expired event',
      )
      break
    }
    case 'sub_agent_started': {
      const event = requireShape(
        value,
        [
          'type',
          'conversation_id',
          'message_id',
          'call_id',
          'sub_conversation_id',
          'spawned_turn_id',
          'kind',
          'description',
        ],
        [],
        'sub_agent_started event',
      )
      requireStringFields(
        event,
        ['type', 'conversation_id', 'message_id', 'call_id', 'sub_conversation_id', 'spawned_turn_id', 'description'],
        'sub_agent_started event',
      )
      requireClosedString(event.kind, ['explore', 'agent'], 'sub_agent_started event.kind')
      break
    }
    case 'auto_review': {
      const event = requireShape(
        value,
        ['type', 'conversation_id', 'turn_id', 'message_id', 'call_id', 'tool_name', 'verdict'],
        [],
        'auto_review event',
      )
      requireStringFields(
        event,
        ['type', 'conversation_id', 'turn_id', 'message_id', 'call_id', 'tool_name'],
        'auto_review event',
      )
      requireAutoReviewVerdict(event.verdict, 'auto_review event.verdict')
      break
    }
    case 'acp_config': {
      const event = requireShape(value, ['type', 'conversation_id', 'config_options'], [], 'acp_config event')
      requireStringFields(event, ['type', 'conversation_id'], 'acp_config event')
      requireAcpConfigOptions(event.config_options, 'acp_config event.config_options')
      break
    }
    case 'acp_usage': {
      const event = requireShape(value, ['type', 'conversation_id', 'used', 'size'], [], 'acp_usage event')
      requireStringFields(event, ['type', 'conversation_id'], 'acp_usage event')
      requireInteger(event.used, 0, Number.MAX_SAFE_INTEGER, 'acp_usage event.used')
      requireInteger(event.size, 0, Number.MAX_SAFE_INTEGER, 'acp_usage event.size')
      break
    }
    case 'stop': {
      const event = requireShape(
        value,
        ['type', 'reason', 'message_id', 'turn_id', 'conversation_id', 'input_tokens', 'output_tokens'],
        [],
        'stop event',
      )
      requireStringFields(event, ['type', 'turn_id', 'conversation_id'], 'stop event')
      requireClosedString(
        event.reason,
        ['end_turn', 'error', 'loop_detected', 'cancelled', 'max_tokens', 'max_turn_requests', 'refusal'],
        'stop event.reason',
      )
      requireNullableString(event, 'message_id', 'stop event')
      if (event.input_tokens !== null) requireInteger(event.input_tokens, I32_MIN, I32_MAX, 'stop event.input_tokens')
      if (event.output_tokens !== null) {
        requireInteger(event.output_tokens, I32_MIN, I32_MAX, 'stop event.output_tokens')
      }
      break
    }
    default: {
      const exhaustive: never = type
      throw new Error(`unhandled chat-stream event type: ${String(exhaustive)}`)
    }
  }

  return value as ChatStreamEvent
}
