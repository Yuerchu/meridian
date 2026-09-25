import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/api'
import { errorMessage } from '@/lib/error-message'
import type { CompactCircuitBreakerState, ConversationAgentKind } from '@/types'

export interface ContextUsageView {
  messageCount: number
  estimatedTokens: number
  contextLimit: number
  autoCompactEnabled: boolean
  autoCompactThreshold: number
  /** `closed` while compaction is being attempted. Anything else means enough
   *  summarisations failed in a row that it has stopped trying — the setting is
   *  still on, and the count will only keep climbing, so it has to be said. */
  compactBreaker: CompactCircuitBreakerState
  /** The model the window is being measured against, which is the turn's own
   *  rather than the assistant's once a conversation has pinned one. */
  model: string
  /** `agent` / `explore` for a delegated run, `claude_code` for a hosted
   *  session, null for an ordinary conversation. */
  agentKind: ConversationAgentKind | null
}

/**
 * What is known about the window, which before the first answer is nothing.
 *
 * There is no placeholder reading. This used to start from the assistant's
 * `context_limit ?? 128000`, a window nobody had configured, and a failed read
 * left whatever the previous one had said — so a model whose window was never
 * set was measured against 128k, or against the model it replaced. The backend
 * refuses to size a turn without a window (`resolve_turn_params`), so a read
 * that fails is `unavailable` with the reason it gave, and the gauge says so.
 */
export type ContextInfoState =
  { status: 'loading' } | { status: 'ready'; reading: ContextUsageView } | { status: 'unavailable'; reason: string }

/** The state, and a way to ask again — a failed read is shown with its reason
 *  and a retry rather than swallowed. */
export type ContextInfo = ContextInfoState & { retry: () => void }

/** What the transcript looks like from the backend's side: how full it is, and
 *  how close auto-compaction is to firing. */
export function useContextInfo(
  conversationId: string,
  deps: {
    messageCount: number
    compactBoundary: number | null
    compacting: boolean
  },
): ContextInfo {
  const { messageCount, compactBoundary, compacting } = deps
  const [contextInfo, setContextInfo] = useState<ContextInfoState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .getContextInfo(conversationId)
        .then((info) => {
          if (cancelled) return
          setContextInfo({
            status: 'ready',
            reading: {
              messageCount: info.message_count,
              estimatedTokens: info.estimated_tokens,
              contextLimit: info.context_limit,
              autoCompactEnabled: info.auto_compact_enabled,
              autoCompactThreshold: info.compact_threshold,
              compactBreaker: info.circuit_breaker_state,
              model: info.model,
              agentKind: info.agent_kind,
            },
          })
        })
        .catch((reason: unknown) => {
          if (cancelled) return
          // Not the last reading: after a model switch that one describes a
          // window this conversation no longer goes into.
          setContextInfo({ status: 'unavailable', reason: errorMessage(reason) })
        })
    }, 100)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `compacting` is in here for its falling edge. A pass that ran mid-turn
    // changes nothing on disk, so nothing else in this list moves — but it is
    // also where the circuit breaker opens, and a breaker that opened without
    // the indicator noticing leaves "0% until auto-compact" next to a number
    // that will now never come down.
  }, [conversationId, messageCount, compactBoundary, compacting, attempt])

  return useMemo(() => ({ ...contextInfo, retry }), [contextInfo, retry])
}
