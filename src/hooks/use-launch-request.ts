import { useEffect, useRef } from 'react'

import { api } from '@/api'
import { listen } from '@/lib/transport'
import type { LaunchSettingsTab } from '@/types'

/**
 * Opens what Meridian was launched to show: on Android, the keyboard's
 * toolbar launches it asking for the input method's settings. The request
 * waits in the backend until it is taken, so one that arrived before the
 * window was listening is found on mount, and a later one is announced on
 * `launch-request` and taken the same way — the command is the only reader.
 */
export function useLaunchRequest(open: (tab: LaunchSettingsTab) => void) {
  const latest = useRef(open)
  useEffect(() => {
    latest.current = open
  }, [open])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    const take = () => {
      void api
        .takeLaunchRequest()
        .then((request) => {
          if (request && !disposed) latest.current(request.settings_tab)
        })
        .catch(() => undefined)
    }
    void listen('launch-request', take)
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => undefined)
    take()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
}
