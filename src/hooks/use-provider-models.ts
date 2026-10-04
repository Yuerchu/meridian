import { useCallback, useEffect, useState } from 'react'

import { api } from '@/api'
import { describeRejections } from '@/lib/error-message'
import type { ProviderInfoResponse, ProviderModelInfoResponse } from '@/types'

export interface ProviderModels {
  provider: ProviderInfoResponse
  models: ProviderModelInfoResponse[]
}

/**
 * Where the one fetch per opening stands.
 *
 * Not derived from `groups.length`: an answer with no models left that at
 * zero, which read as "not loaded yet" and started the fetch again the moment
 * it finished — for as long as the panel stayed open. `idle` is the only state
 * that fetches; an empty or failed answer is settled until `retry`, which the
 * caller calls when the panel is opened again.
 */
export type ProviderModelsState = 'idle' | 'loading' | 'loaded' | 'empty' | 'failed'

/**
 * Every enabled provider's models, fetched once `wanted` turns true.
 *
 * Some providers answering is enough to pick from. Nothing answering and at
 * least one refusing is a failure, which is not the same sentence as "you have
 * no models" — and `failure` names which providers refused and what they said,
 * rather than a generic "could not load" that sent the reader to the log.
 */
export function useProviderModels(providers: ProviderInfoResponse[], wanted: boolean) {
  const [groups, setGroups] = useState<ProviderModels[]>([])
  const [state, setState] = useState<ProviderModelsState>('idle')
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!wanted || state !== 'idle') return
    setState('loading')
    const enabled = providers.filter((p) => p.is_enabled)
    Promise.allSettled(
      enabled.map(async (provider) => ({
        provider,
        models: await api.fetchProviderModels({ providerId: provider.id, forceRefresh: false }),
      })),
    ).then((results) => {
      const next = results
        .filter((r): r is PromiseFulfilledResult<ProviderModels> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((g) => g.models.length > 0)
      setGroups(next)
      setFailure(
        describeRejections(
          enabled.map((p) => p.name),
          results,
        ),
      )
      if (next.length > 0) setState('loaded')
      else setState(results.some((r) => r.status === 'rejected') ? 'failed' : 'empty')
    })
  }, [wanted, state, providers])

  /** Opening again is the retry for an answer that had nothing in it. */
  const retry = useCallback(() => {
    setState((current) => (current === 'empty' || current === 'failed' ? 'idle' : current))
  }, [])

  return { groups, state, failure, retry }
}
