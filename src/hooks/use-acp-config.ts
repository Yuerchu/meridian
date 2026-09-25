import { useCallback, useEffect, useState } from 'react'

import { api } from '@/api'
import { errorMessage } from '@/lib/error-message'
import { listen } from '@/lib/transport'
import type { AcpConfigOptionInfoResponse } from '@/types'

/**
 * The knobs a hosted Claude Code session exposes, and how to turn them.
 *
 * Nothing here is hardcoded. ACP carries the model, the permission mode and the
 * reasoning effort as *configuration options* whose accepted values the agent
 * decides and re-derives as it goes — picking a model changes which modes
 * exist. So the composer renders what the session reports and nothing else; a
 * list of models kept on this side would be a second answer that goes stale the
 * first time the agent disagrees with it.
 *
 * Empty for an ordinary conversation, and for a hosted one whose adapter is not
 * running. Both mean the same thing to a caller — there is nothing to offer —
 * which is why they are not distinguished here.
 */
/**
 * How full the *agent's* context window is, as it last reported.
 *
 * `used`/`size` is not `input_tokens`/`output_tokens` and is not stored
 * anywhere — see `acp/session.rs`. It is the only honest reading for a hosted
 * conversation, because this app's own estimate describes a request it never
 * makes: a different model, a different limit, and a history the agent is not
 * being sent.
 */
export interface AcpUsage {
  used: number
  size: number
}

export function useAcpConfig(conversationId: string, isHosted: boolean) {
  const [options, setOptions] = useState<AcpConfigOptionInfoResponse[]>([])
  const [usage, setUsage] = useState<AcpUsage | null>(null)
  const [busy, setBusy] = useState(false)
  // Reading the knobs never fails for a reason about the session — an adapter
  // that is not running answers an empty list — so a rejection here is the
  // transport or the contract, and worth saying. Changing one can be refused
  // by the agent, and that refusal is the only explanation for a picker that
  // did not move.
  const [error, setError] = useState<string | null>(null)
  const dismissError = useCallback(() => setError(null), [])

  useEffect(() => {
    setError(null)
    if (!isHosted) {
      setOptions([])
      setUsage(null)
      return
    }
    let alive = true
    // Empty for a conversation whose adapter is not running yet, which after a
    // restart is every one of them until the first message wakes it. What
    // fills it then is the announcement below, not this.
    api
      .acpSessionConfig({ conversationId })
      .then((next) => {
        if (alive) setOptions(next)
      })
      .catch((err: unknown) => {
        if (!alive) return
        // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- no adapter, no options; refilled by the announcement, never saved
        setOptions([])
        setError(errorMessage(err))
      })
    // Not fetched, only listened for: the agent reports it during a turn and
    // there is nowhere it is kept, so before the first report of this session
    // there is nothing to ask for. Absent is drawn as absent.
    setUsage(null)
    return () => {
      alive = false
    }
  }, [conversationId, isHosted])

  // Pushed as well as fetched, and for two reasons that are easy to conflate.
  // The agent changes the knobs on its own — a slash command, a model that
  // turns out to be unavailable — so a fetched set goes stale. And the *first*
  // set arrives this way too: a session opened lazily, which is every reopen
  // after a restart, exists only after the fetch above has already answered
  // empty.
  useEffect(() => {
    if (!isHosted) return
    let alive = true
    const unlisten = listen('chat-stream', (event) => {
      const payload = event.payload
      if (!alive || payload.conversation_id !== conversationId) return
      if (payload.type === 'acp_config') {
        setOptions(payload.config_options)
      }
      // A window of zero is the agent saying nothing useful rather than saying
      // the context is empty, and dividing by it is how a gauge shows NaN%.
      if (payload.type === 'acp_usage' && payload.size > 0) {
        setUsage({ used: payload.used, size: payload.size })
      }
    })
    return () => {
      alive = false
      void unlisten.then((off) => off())
    }
  }, [conversationId, isHosted])

  const set = useCallback(
    async (configId: string, value: unknown) => {
      setBusy(true)
      try {
        // The whole set comes back, because changing one reshapes others.
        setOptions(await api.acpSetSessionConfig({ conversationId, configId, value }))
        setError(null)
      } catch (err) {
        // A refusal leaves the set as it was, which is already what is on
        // screen; what it must not do is leave the reader guessing why the
        // picker did not move.
        setError(errorMessage(err))
        throw err
      } finally {
        setBusy(false)
      }
    },
    [conversationId],
  )

  return { options, usage, set, busy, error, dismissError }
}

/** The option the agent calls `what`, by category or — when it omits one — by id. */
export function findOption(
  options: AcpConfigOptionInfoResponse[],
  what: string,
): AcpConfigOptionInfoResponse | undefined {
  return options.find((o) => (o.category ? o.category.toLowerCase() === what : o.id.toLowerCase() === what))
}

/** Only a `select` has something to pick from. A toggle is carried but not drawn. */
export function isSelect(option: AcpConfigOptionInfoResponse | undefined): boolean {
  if (!option) return false
  return option.type === 'select' || (option.type == null && option.options.length > 0)
}
