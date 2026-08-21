import { useCallback, useEffect, useState } from 'react'

import { api } from '@/api'
import { listen } from '@/lib/transport'
import type { AcpConfigOption } from '@/types'

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
export function useAcpConfig(conversationId: string, isHosted: boolean) {
  const [options, setOptions] = useState<AcpConfigOption[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isHosted) {
      setOptions([])
      return
    }
    let alive = true
    api
      .acpSessionConfig(conversationId)
      .then((next) => {
        if (alive) setOptions(next)
      })
      .catch(() => {
        if (alive) setOptions([])
      })
    return () => {
      alive = false
    }
  }, [conversationId, isHosted])

  // The agent changes these on its own — a slash command, a model that turns
  // out to be unavailable — so the set is pushed as well as fetched. Without
  // this the composer would show the value it last set rather than the one in
  // force.
  useEffect(() => {
    if (!isHosted) return
    let alive = true
    const unlisten = listen<{ conversation_id?: string; config_options?: AcpConfigOption[] }>(
      'chat-stream',
      (event) => {
        const payload = event.payload as { type?: string; conversation_id?: string; config_options?: AcpConfigOption[] }
        if (payload?.type !== 'acp_config') return
        if (payload.conversation_id !== conversationId) return
        if (alive && payload.config_options) setOptions(payload.config_options)
      },
    )
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
        setOptions(await api.acpSetSessionConfig(conversationId, configId, value))
      } finally {
        setBusy(false)
      }
    },
    [conversationId],
  )

  return { options, set, busy }
}

/** The option the agent calls `what`, by category or — when it omits one — by id. */
export function findOption(options: AcpConfigOption[], what: string): AcpConfigOption | undefined {
  return options.find((o) => (o.category ? o.category.toLowerCase() === what : o.id.toLowerCase() === what))
}

/** Only a `select` has something to pick from. A toggle is carried but not drawn. */
export function isSelect(option: AcpConfigOption | undefined): boolean {
  if (!option) return false
  return option.type === 'select' || (option.type == null && option.options.length > 0)
}
