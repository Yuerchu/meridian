import { useCallback, useEffect, useRef } from 'react'

import { api } from '@/api'

/**
 * Ask whether a path names something this conversation's workspace actually
 * holds, without reading it.
 *
 * `workspace_probe_ref` queries metadata only and runs the same lexical,
 * no-follow and handle-based containment checks as the authoritative reader, so
 * one `false` covers "does not exist" and "not reachable from here" alike. Both
 * mean the same thing to every caller here: this is not a workspace reference.
 *
 * Probes are coalesced per conversation and path while one is in flight. They
 * are *not* remembered past that: a later message must observe files created or
 * removed since an earlier render, and a transient failure must not keep a path
 * inert for the rest of the conversation.
 */
export function useReferenceProbe(conversationId: string): (path: string) => Promise<boolean> {
  const cache = useRef(new Map<string, Promise<boolean>>())

  useEffect(() => {
    cache.current.clear()
  }, [conversationId])

  return useCallback(
    (path: string) => {
      const key = `${conversationId}\0${path}`
      const cached = cache.current.get(key)
      if (cached) return cached
      const probe = api
        .workspaceProbeRef({ conversationId, projectId: null, path })
        .then(
          () => true,
          () => false,
        )
        .finally(() => {
          if (cache.current.get(key) === probe) cache.current.delete(key)
        })
      cache.current.set(key, probe)
      return probe
    },
    [conversationId],
  )
}
