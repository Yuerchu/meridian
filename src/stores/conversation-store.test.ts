import { describe, expect, it, vi } from 'vitest'
import { reconcileMessages } from '@/stores/conversation-store'
import type { Message } from '@/types'

vi.mock('@tauri-apps/api/core')

function msg(id: string, over: Partial<Message> = {}): Message {
  return {
    id,
    conversation_id: 'c',
    role: 'assistant',
    content: '',
    provider_id: null,
    model_id: null,
    input_tokens: null,
    output_tokens: null,
    tool_calls: null,
    tool_call_id: null,
    sort_order: 0,
    created_at: 0,
    reasoning_content: null,
    rating: null,
    schema_version: 2,
    is_compact_summary: 0,
    ...over,
  }
}

describe('reconcileMessages', () => {
  it('returns the snapshot when there is nothing to reconcile against', () => {
    const next = [msg('a')]
    expect(reconcileMessages([], next)).toBe(next)
  })

  it('returns the previous array when every row is unchanged', () => {
    const prev = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    const next = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    expect(reconcileMessages(prev, next)).toBe(prev)
  })

  it('keeps references for unchanged rows and takes the new object for changed ones', () => {
    const prev = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    const next = [msg('a', { content: 'one' }), msg('b', { content: 'two, edited' })]
    const out = reconcileMessages(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toBe(next[1])
  })

  it('keeps references for the history when a row is appended', () => {
    const prev = [msg('a', { content: 'one' })]
    const next = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    const out = reconcileMessages(prev, next)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toBe(next[1])
  })

  it('keeps references for survivors when a row is removed', () => {
    const prev = [msg('a', { content: 'one' }), msg('b', { content: 'two' })]
    const next = [msg('b', { content: 'two' })]
    const out = reconcileMessages(prev, next)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(prev[1])
  })

  it('preserves the streamed _blocks when the stored columns match', () => {
    // The stream builds `_blocks` with real tool status; hydrateBlocks rebuilds
    // them from columns and hardcodes 'completed'. Reusing the old object keeps
    // the truthful one.
    const prev = [
      msg('a', {
        content: 'done',
        _blocks: [{ type: 'tool_call', data: { call_id: 'c1', tool_name: 'run', arguments: '{}', status: 'error' } }],
      }),
    ]
    const next = [
      msg('a', {
        content: 'done',
        _blocks: [{ type: 'tool_call', data: { call_id: 'c1', tool_name: 'run', arguments: '{}', status: 'completed' } }],
      }),
    ]
    const out = reconcileMessages(prev, next)
    expect(out[0]).toBe(prev[0])
    expect(out[0]._blocks?.[0]).toMatchObject({ data: { status: 'error' } })
  })

  it('treats a row as changed when only its position moved', () => {
    const prev = [msg('a'), msg('b')]
    const next = [msg('b'), msg('a')]
    const out = reconcileMessages(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[1])
    expect(out[1]).toBe(prev[0])
  })
})
