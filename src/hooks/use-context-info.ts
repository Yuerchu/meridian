import { useEffect, useState } from 'react'
import { api } from '@/api'
import type { Assistant } from '@/types'

export interface ContextInfo {
  messageCount: number
  estimatedTokens: number
  contextLimit: number
  autoCompactEnabled: boolean
  autoCompactThreshold: number
  compactBreaker: string
  /** The model the window is being measured against, which is the turn's own
   *  rather than the assistant's once a conversation has pinned one. */
  model: string
  /** Set only for a delegated run, and names which kind it is. */
  agentKind?: string
}

/** What the transcript looks like from the backend's side: how full it is, and
 *  how close auto-compaction is to firing. */
export function useContextInfo(
  conversationId: string,
  deps: {
    assistant: Assistant | undefined
    messageCount: number
    compactBoundary: number | null
    compacting: boolean
  },
): ContextInfo {
  const { assistant, messageCount, compactBoundary, compacting } = deps
  const [contextInfo, setContextInfo] = useState<ContextInfo>({
    messageCount: 0,
    estimatedTokens: 0,
    contextLimit: assistant?.context_limit ?? 128000,
    autoCompactEnabled: assistant?.auto_compact_enabled === 1,
    autoCompactThreshold: 0,
    compactBreaker: 'closed',
    model: '',
  })

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .getContextInfo(conversationId)
        .then((info) => {
          if (cancelled) return
          setContextInfo({
            messageCount: info.message_count,
            estimatedTokens: info.estimated_tokens,
            contextLimit: info.context_limit,
            autoCompactEnabled: info.auto_compact_enabled,
            autoCompactThreshold: info.compact_threshold,
            compactBreaker: info.circuit_breaker_state,
            model: info.model,
            agentKind: info.agent_kind,
          })
        })
        .catch(() => {})
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
  }, [conversationId, messageCount, compactBoundary, compacting])

  return contextInfo
}
