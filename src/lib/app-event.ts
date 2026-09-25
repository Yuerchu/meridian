import { parseChatStreamEvent } from '@/lib/chat-stream-event'
import type {
  ChatStreamEvent,
  PlanReviewDeliveryState,
  PlanReviewStatus,
  SandboxBackend,
  UserCommandEvent,
  UserCommandResultResponse,
  WindowInsetsInfoResponse,
} from '@/types'

export interface ConversationUpdatedEvent {
  conversation_id: string
}

export interface QueueUpdatedEvent {
  conversation_id: string
  delivered: boolean
}

export type CompactTrigger = 'manual' | 'threshold' | 'api_error'
export type CompactOutcome = 'completed' | 'fallback' | 'failed'

export interface CompactStartEvent {
  conversation_id: string
  mid_turn: boolean
  trigger: CompactTrigger
}

export interface CompactDoneEvent {
  conversation_id: string
  mid_turn: boolean
  trigger: CompactTrigger
  outcome: CompactOutcome
  tokens_reclaimed: number | null
  error: string | null
}

export type VoiceModelDownloadEvent = {
  type: 'progress'
  downloaded: number
  total: number | null
}

export type VoiceModelDownloadDoneEvent =
  { type: 'completed' } | { type: 'cancelled' } | { type: 'failed'; error: string }

export type WindowInsetsEvent = WindowInsetsInfoResponse

export type RemoteResyncEvent = Record<string, never>

export interface PlanReviewEvent {
  review_id: string
  conversation_id: string
  document_id: string
  revision_id: string
  turn_id: string
  status: PlanReviewStatus
  delivery_state: PlanReviewDeliveryState | null
  lock_version: number
}

export interface AppEventPayloadMap {
  'chat-stream': ChatStreamEvent
  'conversation-updated': ConversationUpdatedEvent
  'queue-updated': QueueUpdatedEvent
  'compact-start': CompactStartEvent
  'compact-done': CompactDoneEvent
  'user-command': UserCommandEvent
  'voice-model-download': VoiceModelDownloadEvent
  'voice-model-download-done': VoiceModelDownloadDoneEvent
  'insets-changed': WindowInsetsEvent
  'remote-resync': RemoteResyncEvent
  'plan-review-requested': PlanReviewEvent
  'plan-review-updated': PlanReviewEvent
}

export type AppEventChannel = keyof AppEventPayloadMap

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const object = value as Record<string, unknown>
  const actual = Object.keys(object).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`)
  }
  return object
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function integerValue(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be a safe integer greater than or equal to ${minimum}`)
  }
  return value as number
}

function nullableInteger(value: unknown, label: string, minimum: number): number | null {
  return value === null ? null : integerValue(value, label, minimum)
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label)
}

function nonnegativeFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number greater than or equal to 0`)
  }
  return value
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new Error(`${label} must be one of: ${values.join(', ')}`)
  }
  return value as T[number]
}

export function parseConversationUpdatedEvent(value: unknown): ConversationUpdatedEvent {
  const event = exactObject(value, ['conversation_id'], 'conversation-updated payload')
  return { conversation_id: stringValue(event.conversation_id, 'conversation-updated payload.conversation_id') }
}

export function parseQueueUpdatedEvent(value: unknown): QueueUpdatedEvent {
  const event = exactObject(value, ['conversation_id', 'delivered'], 'queue-updated payload')
  return {
    conversation_id: stringValue(event.conversation_id, 'queue-updated payload.conversation_id'),
    delivered: booleanValue(event.delivered, 'queue-updated payload.delivered'),
  }
}

export function parseCompactStartEvent(value: unknown): CompactStartEvent {
  const event = exactObject(value, ['conversation_id', 'mid_turn', 'trigger'], 'compact-start payload')
  return {
    conversation_id: stringValue(event.conversation_id, 'compact-start payload.conversation_id'),
    mid_turn: booleanValue(event.mid_turn, 'compact-start payload.mid_turn'),
    trigger: enumValue(event.trigger, ['manual', 'threshold', 'api_error'] as const, 'compact-start payload.trigger'),
  }
}

export function parseCompactDoneEvent(value: unknown): CompactDoneEvent {
  const event = exactObject(
    value,
    ['conversation_id', 'mid_turn', 'trigger', 'outcome', 'tokens_reclaimed', 'error'],
    'compact-done payload',
  )
  const outcome = enumValue(event.outcome, ['completed', 'fallback', 'failed'] as const, 'compact-done payload.outcome')
  const error = nullableString(event.error, 'compact-done payload.error')
  if (outcome === 'completed' && error !== null) {
    throw new Error('compact-done payload.error must be null when outcome is completed')
  }
  if (outcome !== 'completed' && error === null) {
    throw new Error(`compact-done payload.error must be a string when outcome is ${outcome}`)
  }
  return {
    conversation_id: stringValue(event.conversation_id, 'compact-done payload.conversation_id'),
    mid_turn: booleanValue(event.mid_turn, 'compact-done payload.mid_turn'),
    trigger: enumValue(event.trigger, ['manual', 'threshold', 'api_error'] as const, 'compact-done payload.trigger'),
    outcome,
    tokens_reclaimed: nullableInteger(event.tokens_reclaimed, 'compact-done payload.tokens_reclaimed', 0),
    error,
  }
}

function parseUserCommandResult(value: unknown): UserCommandResultResponse {
  const result = exactObject(
    value,
    [
      'conversation_id',
      'turn_id',
      'message_id',
      'status',
      'stdout',
      'stderr',
      'exit_code',
      'timed_out',
      'truncated',
      'sandbox',
      'duration_ms',
      'cwd',
      'host',
      'error',
      'can_retry_without_sandbox',
      'retry_without_sandbox',
    ],
    'user-command finish result',
  )
  const sandbox =
    result.sandbox === null
      ? null
      : enumValue(
          result.sandbox,
          ['host', 'windows_restricted_token', 'container'] as const,
          'user-command finish result.sandbox',
        )
  return {
    conversation_id: stringValue(result.conversation_id, 'user-command finish result.conversation_id'),
    turn_id: stringValue(result.turn_id, 'user-command finish result.turn_id'),
    message_id: stringValue(result.message_id, 'user-command finish result.message_id'),
    status: enumValue(
      result.status,
      ['completed', 'sandbox_denied', 'settings_unreadable', 'timed_out', 'cancelled', 'failed', 'in_doubt'] as const,
      'user-command finish result.status',
    ),
    stdout: stringValue(result.stdout, 'user-command finish result.stdout'),
    stderr: stringValue(result.stderr, 'user-command finish result.stderr'),
    exit_code: nullableInteger(result.exit_code, 'user-command finish result.exit_code', -2_147_483_648),
    timed_out: booleanValue(result.timed_out, 'user-command finish result.timed_out'),
    truncated: booleanValue(result.truncated, 'user-command finish result.truncated'),
    sandbox: sandbox as SandboxBackend | null,
    duration_ms: integerValue(result.duration_ms, 'user-command finish result.duration_ms', 0),
    cwd: stringValue(result.cwd, 'user-command finish result.cwd'),
    host: stringValue(result.host, 'user-command finish result.host'),
    error: nullableString(result.error, 'user-command finish result.error'),
    can_retry_without_sandbox: booleanValue(
      result.can_retry_without_sandbox,
      'user-command finish result.can_retry_without_sandbox',
    ),
    retry_without_sandbox: booleanValue(
      result.retry_without_sandbox,
      'user-command finish result.retry_without_sandbox',
    ),
  }
}

export function parseUserCommandEvent(value: unknown): UserCommandEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('user-command payload must be an object')
  }
  const type = enumValue(
    (value as Record<string, unknown>).type,
    ['start', 'finish'] as const,
    'user-command payload.type',
  )
  if (type === 'start') {
    const event = exactObject(
      value,
      ['type', 'conversation_id', 'turn_id', 'message_id', 'cwd', 'host', 'retry_without_sandbox'],
      'user-command start payload',
    )
    return {
      type,
      conversation_id: stringValue(event.conversation_id, 'user-command start payload.conversation_id'),
      turn_id: stringValue(event.turn_id, 'user-command start payload.turn_id'),
      message_id: stringValue(event.message_id, 'user-command start payload.message_id'),
      cwd: stringValue(event.cwd, 'user-command start payload.cwd'),
      host: stringValue(event.host, 'user-command start payload.host'),
      retry_without_sandbox: booleanValue(
        event.retry_without_sandbox,
        'user-command start payload.retry_without_sandbox',
      ),
    }
  }
  const event = exactObject(value, ['type', 'result'], 'user-command finish payload')
  return { type, result: parseUserCommandResult(event.result) }
}

export function parseVoiceModelDownloadEvent(value: unknown): VoiceModelDownloadEvent {
  const event = exactObject(value, ['type', 'downloaded', 'total'], 'voice-model-download payload')
  const type = enumValue(event.type, ['progress'] as const, 'voice-model-download payload.type')
  return {
    type,
    downloaded: integerValue(event.downloaded, 'voice-model-download payload.downloaded', 0),
    total: nullableInteger(event.total, 'voice-model-download payload.total', 0),
  }
}

export function parseVoiceModelDownloadDoneEvent(value: unknown): VoiceModelDownloadDoneEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('voice-model-download-done payload must be an object')
  }
  const type = enumValue(
    (value as Record<string, unknown>).type,
    ['completed', 'cancelled', 'failed'] as const,
    'voice-model-download-done payload.type',
  )
  if (type === 'failed') {
    const event = exactObject(value, ['type', 'error'], 'voice-model-download-done failed payload')
    return { type, error: stringValue(event.error, 'voice-model-download-done failed payload.error') }
  }
  exactObject(value, ['type'], `voice-model-download-done ${type} payload`)
  return { type }
}

export function parseWindowInsetsEvent(value: unknown): WindowInsetsEvent {
  const event = exactObject(value, ['top', 'right', 'bottom', 'left', 'imeBottom'], 'insets-changed payload')
  return {
    top: nonnegativeFiniteNumber(event.top, 'insets-changed payload.top'),
    right: nonnegativeFiniteNumber(event.right, 'insets-changed payload.right'),
    bottom: nonnegativeFiniteNumber(event.bottom, 'insets-changed payload.bottom'),
    left: nonnegativeFiniteNumber(event.left, 'insets-changed payload.left'),
    imeBottom: nonnegativeFiniteNumber(event.imeBottom, 'insets-changed payload.imeBottom'),
  }
}

export function parseRemoteResyncEvent(value: unknown): RemoteResyncEvent {
  exactObject(value, [], 'remote-resync payload')
  return {}
}

export function parsePlanReviewEvent(value: unknown, channel = 'plan-review'): PlanReviewEvent {
  const event = exactObject(
    value,
    [
      'review_id',
      'conversation_id',
      'document_id',
      'revision_id',
      'turn_id',
      'status',
      'delivery_state',
      'lock_version',
    ],
    `${channel} payload`,
  )
  return {
    review_id: stringValue(event.review_id, `${channel} payload.review_id`),
    conversation_id: stringValue(event.conversation_id, `${channel} payload.conversation_id`),
    document_id: stringValue(event.document_id, `${channel} payload.document_id`),
    revision_id: stringValue(event.revision_id, `${channel} payload.revision_id`),
    turn_id: stringValue(event.turn_id, `${channel} payload.turn_id`),
    status: enumValue(
      event.status,
      ['pending', 'approved', 'changes_requested', 'orphaned'] as const,
      `${channel} payload.status`,
    ),
    delivery_state:
      event.delivery_state === null
        ? null
        : enumValue(
            event.delivery_state,
            ['queued', 'dispatched', 'acknowledged', 'held', 'in_doubt'] as const,
            `${channel} payload.delivery_state`,
          ),
    lock_version: integerValue(event.lock_version, `${channel} payload.lock_version`, 0),
  }
}

/**
 * Validate every backend-owned event at the transport boundary. The exported
 * `listen` wrapper calls this for local Tauri and remote WebSocket delivery;
 * callers never receive a locally trusted shape and a remotely checked one.
 */
export function parseAppEventPayload<C extends AppEventChannel>(channel: C, value: unknown): AppEventPayloadMap[C]
export function parseAppEventPayload(channel: string, value: unknown): unknown
export function parseAppEventPayload(channel: string, value: unknown): unknown {
  switch (channel) {
    case 'chat-stream':
      return parseChatStreamEvent(value)
    case 'conversation-updated':
      return parseConversationUpdatedEvent(value)
    case 'queue-updated':
      return parseQueueUpdatedEvent(value)
    case 'compact-start':
      return parseCompactStartEvent(value)
    case 'compact-done':
      return parseCompactDoneEvent(value)
    case 'user-command':
      return parseUserCommandEvent(value)
    case 'voice-model-download':
      return parseVoiceModelDownloadEvent(value)
    case 'voice-model-download-done':
      return parseVoiceModelDownloadDoneEvent(value)
    case 'insets-changed':
      return parseWindowInsetsEvent(value)
    case 'remote-resync':
      return parseRemoteResyncEvent(value)
    case 'plan-review-requested':
    case 'plan-review-updated':
      return parsePlanReviewEvent(value, channel)
    default:
      throw new Error(`unknown app event channel: ${channel}`)
  }
}
