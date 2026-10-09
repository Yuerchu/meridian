import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import type { AttentionItem } from '@/stores/conversation-store'
import type { TurnInfoResponse, TurnStatus } from '@/types'
import { agentStateOf, askedAtOf, needsPerson } from './agent-state'

const t = ((key: string) => key) as unknown as TFunction
const started = { conversation_id: 'c1' }

function turn(status: TurnStatus, error: string | null = null): TurnInfoResponse {
  return {
    id: `turn-${status}`,
    status,
    phase: null,
    phase_tool: null,
    error,
    started_at: 1,
    ended_at: status === 'running' ? null : 2,
    usage: null,
    trigger: 'user',
  }
}

function session(turns: TurnInfoResponse[], streaming = false) {
  return { streaming, messages: [], turns }
}

function asking(kind: 'approval' | 'ask', askedAt: number): AttentionItem {
  return {
    conversationId: 'c1',
    approvalId: `${kind}-${askedAt}`,
    providerCallId: 'p',
    messageId: 'm',
    toolName: kind === 'ask' ? 'ask_user' : 'run_command',
    arguments: '{}',
    kind,
    askedAt,
  }
}

describe('agentStateOf', () => {
  it('is idle before the card starts, whatever else is around', () => {
    expect(agentStateOf(t, { conversation_id: null }, session([turn('running')], true), [])).toEqual({
      kind: 'idle',
    })
  })

  it('says what waits on a person before anything else, oldest first', () => {
    const state = agentStateOf(t, started, session([turn('running')], true), [
      asking('ask', 20),
      asking('approval', 10),
    ])
    expect(state.kind).toBe('approval')
    expect(askedAtOf(state)).toBe(10)
    expect(agentStateOf(t, started, session([turn('running')]), [asking('ask', 5)]).kind).toBe('question')
  })

  it('is working while a turn streams or is recorded as running', () => {
    expect(agentStateOf(t, started, session([], true), []).kind).toBe('working')
    expect(agentStateOf(t, started, session([turn('running')]), []).kind).toBe('working')
  })

  it('reads how the last turn ended from its durable status', () => {
    expect(agentStateOf(t, started, session([turn('done'), turn('failed', 'quota')]), [])).toEqual({
      kind: 'failed',
      reason: 'quota',
      at: 2,
    })
    expect(agentStateOf(t, started, session([turn('interrupted')]), []).kind).toBe('failed')
    expect(agentStateOf(t, started, session([turn('cancelled')]), [])).toMatchObject({
      kind: 'finished',
      stopped: true,
    })
    expect(agentStateOf(t, started, session([turn('done')]), [])).toMatchObject({ kind: 'finished', stopped: false })
  })

  it('is idle when a started card has not run yet or has no session', () => {
    expect(agentStateOf(t, started, session([]), []).kind).toBe('idle')
    expect(agentStateOf(t, started, undefined, []).kind).toBe('idle')
  })
})

describe('needsPerson', () => {
  it('is the asking and the failed, not the working or the finished', () => {
    expect(needsPerson(agentStateOf(t, started, session([]), [asking('approval', 1)]))).toBe(true)
    expect(needsPerson(agentStateOf(t, started, session([turn('failed')]), []))).toBe(true)
    expect(needsPerson(agentStateOf(t, started, session([], true), []))).toBe(false)
    expect(needsPerson(agentStateOf(t, started, session([turn('done')]), []))).toBe(false)
  })
})
