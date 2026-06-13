import * as React from 'react'
import { api } from '@/api'

let cached: string | null = null

/** OS platform from the Rust backend: 'android' | 'windows' | 'macos' | 'linux' | ... */
export function usePlatform() {
  const [platform, setPlatform] = React.useState<string | null>(cached)

  React.useEffect(() => {
    if (cached !== null) return
    api.getPlatform().then((p) => {
      cached = p
      setPlatform(p)
    })
  }, [])

  return platform
}
