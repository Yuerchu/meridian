import type { ChatStreamEvent } from '@/types'

import { parseChatStreamEvent } from './chat-stream-event'

const validEvents: ChatStreamEvent[] = [
  { type: 'text', content: 'hello', message_id: 'm1', conversation_id: 'c1' },
  { type: 'reasoning', content: 'thinking', message_id: 'm1', conversation_id: 'c1' },
  { type: 'message_start', message_id: 'm1', turn_id: 't1', conversation_id: 'c1' },
  { type: 'user_message', content: 'steer', message_id: 'm2', conversation_id: 'c1' },
  { type: 'retry', attempt: 1, max_attempts: 3, delay_ms: 500, message_id: 'm1', conversation_id: 'c1' },
  { type: 'reset', message_id: 'm1', conversation_id: 'c1' },
  {
    type: 'server_tool',
    message_id: 'm1',
    conversation_id: 'c1',
    call: {
      id: 'provider-call-1',
      name: 'web_search',
      arguments: null,
      sources: ['https://example.com'],
      completed: true,
    },
  },
  {
    type: 'tool_call',
    call_id: 'call-1',
    tool_name: 'read_file',
    arguments: '{"path":"README.md"}',
    message_id: 'm1',
    conversation_id: 'c1',
  },
  {
    type: 'tool_call_revised',
    call_id: 'call-1',
    tool_name: 'read_file',
    arguments: '{"path":"CLAUDE.md"}',
    message_id: 'm1',
    conversation_id: 'c1',
  },
  {
    type: 'tool_result',
    call_id: 'call-1',
    result: 'contents',
    outcome: 'success',
    message_id: 'm1',
    conversation_id: 'c1',
  },
  {
    type: 'tool_approval_req',
    approval_id: 'approval-1',
    call_id: 'call-1',
    tool_name: 'run_command',
    arguments: '{"cmd":"cargo test"}',
    message_id: 'm1',
    conversation_id: 'c1',
    delegation: { parent_call_id: 'parent-1', sub_conversation_id: 'sub-1' },
    retry: { kind: 'sandbox_denied', reason: 'sandbox denied', origin_call_id: 'origin-1' },
    asked_at: 1_700_000_000_000,
  },
  {
    type: 'tool_approval_expired',
    approval_id: 'approval-1',
    call_id: 'call-1',
    tool_name: 'run_command',
    message_id: 'm1',
    conversation_id: 'c1',
  },
  {
    type: 'sub_agent_started',
    conversation_id: 'c1',
    message_id: 'm1',
    call_id: 'call-1',
    sub_conversation_id: 'sub-1',
    spawned_turn_id: 'sub-turn-1',
    kind: 'explore',
    description: 'inspect provider code',
  },
  {
    type: 'auto_review',
    conversation_id: 'c1',
    turn_id: 't1',
    message_id: 'm1',
    call_id: 'call-1',
    tool_name: 'run_command',
    verdict: {
      outcome: 'allow',
      risk: 'low',
      authorization: 'high',
      rationale: 'read only',
      stage: 'investigate',
      model: 'reviewer',
      evidence: [{ tool: 'read_file', arguments: '{"path":"Cargo.toml"}' }],
    },
  },
  {
    type: 'acp_config',
    conversation_id: 'c1',
    config_options: [
      {
        id: 'model',
        name: 'Model',
        description: 'Session model',
        category: 'model',
        type: 'select',
        currentValue: 'sonnet',
        options: [{ value: 'sonnet', name: 'Sonnet', description: 'Balanced' }],
      },
    ],
  },
  { type: 'acp_usage', conversation_id: 'c1', used: 120, size: 1_000 },
  {
    type: 'acp_notice',
    conversation_id: 'c1',
    notice: {
      id: 'n1',
      conversation_id: 'c1',
      turn_id: null,
      notice_id: 'sess:notice:1:1',
      revision: 1,
      category: 'limit',
      severity: 'warning',
      title: 'Retrying Claude, attempt 1 of 5.',
      details: null,
      reason: null,
      actions: [],
      created_at: 1,
      updated_at: 1,
    },
  },
  {
    type: 'tool_call_diff',
    conversation_id: 'c1',
    message_id: 'm1',
    call_id: 'toolu_1',
    diffs: [{ path: 'src/lib.rs', old_text: null, new_text: 'fn main() {}', line: null }],
  },
  {
    type: 'stop',
    reason: 'end_turn',
    message_id: 'm1',
    turn_id: 't1',
    conversation_id: 'c1',
    input_tokens: 10,
    output_tokens: 20,
  },
]

describe('parseChatStreamEvent', () => {
  it('accepts every declared tagged variant', () => {
    for (const event of validEvents) expect(parseChatStreamEvent(event)).toBe(event)
  })

  it('rejects an extra field on a variant', () => {
    expect(() =>
      parseChatStreamEvent({
        type: 'text',
        content: 'hello',
        message_id: 'm1',
        conversation_id: 'c1',
        future: true,
      }),
    ).toThrow('text event contains unknown field: future')
  })

  it('rejects an unknown tagged variant', () => {
    expect(() => parseChatStreamEvent({ type: 'future_delta', conversation_id: 'c1' })).toThrow(
      'unknown chat-stream event type: future_delta',
    )
  })

  it('rejects a malformed nested server-tool call', () => {
    expect(() =>
      parseChatStreamEvent({
        type: 'server_tool',
        message_id: 'm1',
        conversation_id: 'c1',
        call: {
          id: 'provider-call-1',
          name: 'web_search',
          arguments: '{}',
          sources: ['https://example.com', 7],
          completed: true,
        },
      }),
    ).toThrow('server_tool event.call.sources[1] must be a string')
  })

  it('rejects unknown fields and enum values inside an auto-review verdict', () => {
    const base = {
      type: 'auto_review',
      conversation_id: 'c1',
      turn_id: 't1',
      message_id: 'm1',
      call_id: 'call-1',
      tool_name: 'run_command',
    }
    const verdict = {
      outcome: 'allow',
      risk: null,
      authorization: null,
      rationale: null,
      stage: null,
      model: null,
      evidence: [],
    }
    expect(() => parseChatStreamEvent({ ...base, verdict: { ...verdict, future: true } })).toThrow(
      'auto_review event.verdict contains unknown field: future',
    )
    expect(() => parseChatStreamEvent({ ...base, verdict: { ...verdict, outcome: 'maybe' } })).toThrow(
      'auto_review event.verdict.outcome must be one of',
    )
  })

  it('rejects omitted nullable keys instead of treating omission as null', () => {
    expect(() =>
      parseChatStreamEvent({
        type: 'server_tool',
        message_id: 'm1',
        conversation_id: 'c1',
        call: { id: 'provider-call-1', name: 'web_search', sources: [], completed: false },
      }),
    ).toThrow('server_tool event.call is missing required field: arguments')

    expect(() =>
      parseChatStreamEvent({
        type: 'tool_approval_req',
        approval_id: 'approval-1',
        call_id: 'call-1',
        tool_name: 'run_command',
        arguments: '{}',
        message_id: 'm1',
        conversation_id: 'c1',
        retry: null,
      }),
    ).toThrow('tool_approval_req event is missing required field: delegation')

    const approval = {
      type: 'tool_approval_req',
      approval_id: 'approval-1',
      call_id: 'call-1',
      tool_name: 'run_command',
      arguments: '{}',
      message_id: 'm1',
      conversation_id: 'c1',
      delegation: null,
      retry: null,
      asked_at: 1_700_000_000_000,
    }
    expect(() => parseChatStreamEvent({ ...approval, asked_at: undefined })).toThrow('asked_at')
    expect(() => parseChatStreamEvent({ ...approval, asked_at: '1700000000000' })).toThrow('asked_at')
    expect(() => parseChatStreamEvent({ ...approval, retry: { reason: 'x', origin_call_id: 'call-1' } })).toThrow(
      'kind',
    )
    expect(() =>
      parseChatStreamEvent({ ...approval, retry: { kind: 'guessed', reason: 'x', origin_call_id: 'call-1' } }),
    ).toThrow('kind')
    expect(
      parseChatStreamEvent({
        ...approval,
        retry: { kind: 'settings_unreadable', reason: 'database is locked', origin_call_id: 'call-1' },
      }),
    ).toMatchObject({ retry: { kind: 'settings_unreadable' } })

    expect(() =>
      parseChatStreamEvent({
        type: 'stop',
        reason: 'end_turn',
        message_id: null,
        turn_id: 't1',
        conversation_id: 'c1',
        output_tokens: null,
      }),
    ).toThrow('stop event is missing required field: input_tokens')

    expect(() =>
      parseChatStreamEvent({
        type: 'auto_review',
        conversation_id: 'c1',
        turn_id: 't1',
        message_id: 'm1',
        call_id: 'call-1',
        tool_name: 'run_command',
        verdict: {
          outcome: 'allow',
          authorization: null,
          rationale: null,
          stage: null,
          model: null,
          evidence: [],
        },
      }),
    ).toThrow('auto_review event.verdict is missing required field: risk')
  })

  it('rejects non-integer usage and extended ACP options', () => {
    expect(() => parseChatStreamEvent({ type: 'acp_usage', conversation_id: 'c1', used: 0.5, size: 100 })).toThrow(
      'acp_usage event.used must be an integer',
    )
    expect(() =>
      parseChatStreamEvent({
        type: 'acp_config',
        conversation_id: 'c1',
        config_options: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'sonnet',
            options: [],
            future: true,
          },
        ],
      }),
    ).toThrow('acp_config event.config_options[0] contains unknown field: future')

    expect(() =>
      parseChatStreamEvent({
        type: 'acp_config',
        conversation_id: 'c1',
        config_options: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'sonnet',
            options: [],
          },
        ],
      }),
    ).toThrow('acp_config event.config_options[0] is missing required field: description')
  })
})

describe('acp_notice', () => {
  const notice = {
    id: 'n1',
    conversation_id: 'c1',
    turn_id: null,
    notice_id: 'sess:notice:1:1',
    revision: 1,
    category: 'limit',
    severity: 'warning',
    title: 'Retrying Claude, attempt 1 of 5.',
    details: null,
    reason: null,
    actions: ['retry'],
    created_at: 1,
    updated_at: 1,
  }

  it('rejects an absent nullable key, an unknown category and an unknown action', () => {
    const { details: _details, ...missing } = notice
    expect(() => parseChatStreamEvent({ type: 'acp_notice', conversation_id: 'c1', notice: missing })).toThrow(
      'acp_notice event.notice is missing required field: details',
    )
    expect(() =>
      parseChatStreamEvent({ type: 'acp_notice', conversation_id: 'c1', notice: { ...notice, category: 'weather' } }),
    ).toThrow('acp_notice event.notice.category must be one of')
    expect(() =>
      parseChatStreamEvent({ type: 'acp_notice', conversation_id: 'c1', notice: { ...notice, actions: ['teleport'] } }),
    ).toThrow('acp_notice event.notice.actions[0] must be one of')
    expect(() =>
      parseChatStreamEvent({ type: 'acp_notice', conversation_id: 'c1', notice: { ...notice, extra: 1 } }),
    ).toThrow()
  })
})

describe('tool_call_diff', () => {
  const base = { type: 'tool_call_diff', conversation_id: 'c1', message_id: 'm1', call_id: 'toolu_1' }

  it('rejects a hunk missing a nullable key, a zero line, or an unknown key', () => {
    expect(() => parseChatStreamEvent({ ...base, diffs: [{ path: 'a', new_text: 'b', line: null }] })).toThrow(
      'tool_call_diff event.diffs[0] is missing required field: old_text',
    )
    expect(() =>
      parseChatStreamEvent({ ...base, diffs: [{ path: 'a', old_text: null, new_text: 'b', line: 0 }] }),
    ).toThrow('tool_call_diff event.diffs[0].line must be an integer from 1')
    expect(() =>
      parseChatStreamEvent({ ...base, diffs: [{ path: 'a', old_text: null, new_text: 'b', line: 1, extra: 1 }] }),
    ).toThrow()
  })
})
