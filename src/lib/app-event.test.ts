import { describe, expect, it } from 'vitest'

import {
  parseAppEventPayload,
  parseCompactDoneEvent,
  parseCompactStartEvent,
  parseConversationUpdatedEvent,
  parseQueueUpdatedEvent,
  parsePlanReviewEvent,
  parseRemoteResyncEvent,
  parseUserCommandEvent,
  parseVoiceModelDownloadDoneEvent,
  parseVoiceModelDownloadEvent,
  parseWindowInsetsEvent,
} from './app-event'

const commandResult = {
  conversation_id: 'conversation-1',
  turn_id: 'turn-1',
  message_id: 'message-1',
  status: 'completed',
  stdout: 'done',
  stderr: '',
  exit_code: 0,
  timed_out: false,
  truncated: false,
  sandbox: 'host',
  duration_ms: 5,
  cwd: 'C:/repo',
  host: 'desktop',
  error: null,
  can_retry_without_sandbox: false,
  retry_without_sandbox: false,
}

describe('closed first-party event contracts', () => {
  it('accepts the exact conversation and queue shapes', () => {
    expect(parseConversationUpdatedEvent({ conversation_id: 'conversation-1' })).toEqual({
      conversation_id: 'conversation-1',
    })
    expect(parseQueueUpdatedEvent({ conversation_id: 'conversation-1', delivered: false })).toEqual({
      conversation_id: 'conversation-1',
      delivered: false,
    })
  })

  it('rejects old names, missing queue flags, and extra fields', () => {
    expect(() => parseConversationUpdatedEvent({ id: 'conversation-1' })).toThrow('must contain exactly')
    expect(() => parseQueueUpdatedEvent({ conversation_id: 'conversation-1' })).toThrow('must contain exactly')
    expect(() => parseQueueUpdatedEvent({ conversation_id: 'conversation-1', delivered: false, future: true })).toThrow(
      'must contain exactly',
    )
  })

  it('requires one complete compact-start and compact-done shape', () => {
    expect(parseCompactStartEvent({ conversation_id: 'conversation-1', mid_turn: true, trigger: 'threshold' })).toEqual(
      { conversation_id: 'conversation-1', mid_turn: true, trigger: 'threshold' },
    )
    expect(
      parseCompactDoneEvent({
        conversation_id: 'conversation-1',
        mid_turn: true,
        trigger: 'threshold',
        outcome: 'completed',
        tokens_reclaimed: 42,
        error: null,
      }),
    ).toMatchObject({ outcome: 'completed', tokens_reclaimed: 42, error: null })
  })

  it('rejects missing, extra, unknown, and inconsistent compaction values', () => {
    expect(() =>
      parseCompactStartEvent({ conversation_id: 'conversation-1', mid_turn: true, trigger: 'future' }),
    ).toThrow('trigger must be one of')
    expect(() =>
      parseCompactDoneEvent({
        conversation_id: 'conversation-1',
        mid_turn: true,
        trigger: 'threshold',
        outcome: 'completed',
        error: null,
      }),
    ).toThrow('must contain exactly')
    expect(() =>
      parseCompactDoneEvent({
        conversation_id: 'conversation-1',
        mid_turn: true,
        trigger: 'threshold',
        outcome: 'completed',
        tokens_reclaimed: null,
        error: 'not allowed',
      }),
    ).toThrow('must be null')
    expect(() =>
      parseCompactDoneEvent({
        conversation_id: 'conversation-1',
        mid_turn: true,
        trigger: 'threshold',
        outcome: 'failed',
        tokens_reclaimed: null,
        error: null,
        future: true,
      }),
    ).toThrow('must contain exactly')
  })

  it('parses both tagged user-command variants and rejects incomplete results', () => {
    expect(
      parseUserCommandEvent({
        type: 'start',
        conversation_id: 'conversation-1',
        turn_id: 'turn-1',
        message_id: 'message-1',
        cwd: 'C:/repo',
        host: 'desktop',
        retry_without_sandbox: false,
      }),
    ).toMatchObject({ type: 'start', conversation_id: 'conversation-1' })
    expect(parseUserCommandEvent({ type: 'finish', result: commandResult })).toEqual({
      type: 'finish',
      result: commandResult,
    })

    const { error: _error, ...missingError } = commandResult
    expect(() => parseUserCommandEvent({ type: 'finish', result: missingError })).toThrow('must contain exactly')
    expect(() => parseUserCommandEvent({ type: 'future' })).toThrow('type must be one of')
    expect(() =>
      parseUserCommandEvent({
        type: 'start',
        conversation_id: 'conversation-1',
        turn_id: 'turn-1',
        message_id: 'message-1',
        cwd: 'C:/repo',
        host: 'desktop',
        retry_without_sandbox: false,
        future: true,
      }),
    ).toThrow('must contain exactly')
  })

  it('uses tagged, exact voice progress and terminal variants', () => {
    expect(parseVoiceModelDownloadEvent({ type: 'progress', downloaded: 10, total: null })).toEqual({
      type: 'progress',
      downloaded: 10,
      total: null,
    })
    expect(parseVoiceModelDownloadDoneEvent({ type: 'completed' })).toEqual({ type: 'completed' })
    expect(parseVoiceModelDownloadDoneEvent({ type: 'cancelled' })).toEqual({ type: 'cancelled' })
    expect(parseVoiceModelDownloadDoneEvent({ type: 'failed', error: 'network' })).toEqual({
      type: 'failed',
      error: 'network',
    })

    expect(() => parseVoiceModelDownloadEvent({ downloaded: 10, total: null })).toThrow('must contain exactly')
    expect(() => parseVoiceModelDownloadEvent({ type: 'future', downloaded: 10, total: null })).toThrow(
      'type must be one of',
    )
    expect(() => parseVoiceModelDownloadDoneEvent({ type: 'completed', error: 'ignored before' })).toThrow(
      'must contain exactly',
    )
  })

  it('validates device-local insets and resync payloads exactly', () => {
    const insets = { top: 1.5, right: 0, bottom: 24, left: 0, imeBottom: 320.25 }
    expect(parseWindowInsetsEvent(insets)).toEqual(insets)
    expect(() => parseWindowInsetsEvent({ ...insets, future: true })).toThrow('must contain exactly')
    expect(() => parseWindowInsetsEvent({ ...insets, imeBottom: -1 })).toThrow('finite number')
    expect(parseRemoteResyncEvent({})).toEqual({})
    expect(() => parseRemoteResyncEvent({ replayed: false })).toThrow('must contain exactly')
  })

  it('keeps plan-review events as exact invalidations', () => {
    const event = {
      review_id: 'review-1',
      conversation_id: 'conversation-1',
      document_id: 'document-1',
      revision_id: 'revision-1',
      turn_id: 'turn-1',
      status: 'pending',
      delivery_state: null,
      lock_version: 0,
    }
    expect(parsePlanReviewEvent(event)).toEqual(event)
    expect(parseAppEventPayload('plan-review-updated', { ...event, status: 'approved' })).toMatchObject({
      review_id: 'review-1',
      status: 'approved',
    })
    expect(parsePlanReviewEvent({ ...event, status: 'approved', delivery_state: 'queued' })).toMatchObject({
      status: 'approved',
      delivery_state: 'queued',
    })
    const { delivery_state: _deliveryState, ...missingDelivery } = event
    expect(() => parsePlanReviewEvent(missingDelivery)).toThrow('must contain exactly')
    expect(() => parsePlanReviewEvent({ ...event, delivery_state: 'future' })).toThrow('delivery_state must be one of')
    expect(() => parsePlanReviewEvent({ ...event, status: 'future' })).toThrow('status must be one of')
  })

  it('dispatches the same exact parser from the transport boundary', () => {
    expect(parseAppEventPayload('queue-updated', { conversation_id: 'conversation-1', delivered: true })).toEqual({
      conversation_id: 'conversation-1',
      delivered: true,
    })
    expect(() => parseAppEventPayload('queue-updated', { conversation_id: 'conversation-1' })).toThrow(
      'must contain exactly',
    )
    expect(() => parseAppEventPayload('future-channel', {})).toThrow('unknown app event channel')
  })
})
