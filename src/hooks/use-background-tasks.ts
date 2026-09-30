import { useCallback, useEffect, useState } from 'react'

import { api } from '@/api'
import { errorMessage } from '@/lib/error-message'
import { listen } from '@/lib/transport'
import type { BackgroundTaskInfoResponse } from '@/types'

/**
 * The commands a conversation left running, read back from the backend on
 * every change rather than kept in step here.
 *
 * `background-tasks-updated` carries the conversation id and nothing else, as
 * `queue-updated` does: a task starts, ends or is stopped without anybody
 * touching this window, and a copy maintained locally would disagree with the
 * rows at exactly those moments.
 *
 * A failed read keeps the rows already on screen; a failed stop is reported
 * and the list re-read, since the backend's answer is what the rows are.
 */
/** What went wrong: reading the list, or stopping a task. */
export interface BackgroundTasksError {
  kind: 'load' | 'stop'
  message: string
}

export function useBackgroundTasks(conversationId: string) {
  const [tasks, setTasks] = useState<BackgroundTaskInfoResponse[]>([])
  const [error, setError] = useState<BackgroundTasksError | null>(null)

  const read = useCallback(
    () =>
      api.listBackgroundTasks(conversationId).then(
        (next) => {
          setTasks(next)
          return true
        },
        (err: unknown) => {
          setError({ kind: 'load', message: errorMessage(err) })
          return false
        },
      ),
    [conversationId],
  )

  useEffect(() => {
    let alive = true
    setTasks([])
    setError(null)
    api.listBackgroundTasks(conversationId).then(
      (next) => {
        if (alive) setTasks(next)
      },
      (err: unknown) => {
        if (alive) setError({ kind: 'load', message: errorMessage(err) })
      },
    )
    const unlisten = listen('background-tasks-updated', (event) => {
      if (!alive || event.payload.conversation_id !== conversationId) return
      api.listBackgroundTasks(conversationId).then(
        (next) => {
          if (alive) setTasks(next)
        },
        (err: unknown) => {
          if (alive) setError({ kind: 'load', message: errorMessage(err) })
        },
      )
    })
    return () => {
      alive = false
      void unlisten.then((off) => off())
    }
  }, [conversationId])

  const stop = useCallback(
    async (id: string) => {
      try {
        await api.stopBackgroundTask({ conversationId, id })
      } catch (err) {
        setError({ kind: 'stop', message: errorMessage(err) })
      } finally {
        await read()
      }
    },
    [conversationId, read],
  )

  const dismissError = useCallback(() => setError(null), [])

  return { tasks, error, stop, dismissError }
}
