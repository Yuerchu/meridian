import { useEffect, useState, useSyncExternalStore } from 'react'
import { listen } from '@/lib/transport'
import { api } from '@/api'
import type { WindowInsetsEvent } from '@/lib/app-event'
import type { PlatformInfoResponse } from '@/types'

let currentImeBottom = 0
const imeListeners = new Set<() => void>()

function applyInsets(i: WindowInsetsEvent) {
  const s = document.documentElement.style
  s.setProperty('--native-inset-top', `${i.top}px`)
  s.setProperty('--native-inset-bottom', `${i.bottom}px`)
  s.setProperty('--native-inset-left', `${i.left}px`)
  s.setProperty('--native-inset-right', `${i.right}px`)
  s.setProperty('--ime-bottom', `${i.imeBottom}px`)
  if (i.imeBottom !== currentImeBottom) {
    currentImeBottom = i.imeBottom
    imeListeners.forEach((fn) => fn())
  }
}

function subscribeIme(cb: () => void) {
  imeListeners.add(cb)
  return () => {
    imeListeners.delete(cb)
  }
}

function getImeSnapshot() {
  return currentImeBottom
}

export function useImeBottom(): number {
  return useSyncExternalStore(subscribeIme, getImeSnapshot)
}

export function useAndroidInsets() {
  const [platform, setPlatform] = useState<PlatformInfoResponse | null>(null)

  useEffect(() => {
    let disposed = false
    void (async () => {
      const p = await api.getPlatform().catch(() => null)
      if (!disposed) setPlatform(p)
    })()
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    if (platform !== 'android') return
    let disposed = false
    let unlistenInsets: (() => void) | null = null

    void (async () => {
      const unlisten = await listen('insets-changed', (e) => applyInsets(e.payload)).catch(() => null)
      if (disposed) {
        unlisten?.()
        return
      }
      unlistenInsets = unlisten

      const insets = await api.getWindowInsets().catch(() => null)
      if (insets && !disposed) applyInsets(insets)
    })()

    const resetScroll = () => {
      window.scrollTo(0, 0)
    }
    window.addEventListener('scroll', resetScroll, { passive: true })
    return () => {
      disposed = true
      unlistenInsets?.()
      window.removeEventListener('scroll', resetScroll)
    }
  }, [platform])
}
