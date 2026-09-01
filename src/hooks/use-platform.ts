import * as React from 'react'
import { api } from '@/api'
import type { PlatformInfoResponse } from '@/types'

let cached: PlatformInfoResponse | null = null

/** Closed OS platform returned by the Rust backend. */
export function usePlatform() {
  const [platform, setPlatform] = React.useState<PlatformInfoResponse | null>(cached)

  React.useEffect(() => {
    if (cached !== null) return
    api.getPlatform().then((p) => {
      cached = p
      setPlatform(p)
    })
  }, [])

  return platform
}
