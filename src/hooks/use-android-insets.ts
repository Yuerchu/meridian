import { useEffect, useSyncExternalStore } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api } from '@/api'

export interface NativeInsets {
  top: number
  bottom: number
  left: number
  right: number
  imeBottom: number
}

let currentImeBottom = 0
const imeListeners = new Set<() => void>()

function applyInsets(i: NativeInsets) {
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
  return () => { imeListeners.delete(cb) }
}

function getImeSnapshot() {
  return currentImeBottom
}

export function useImeBottom(): number {
  return useSyncExternalStore(subscribeIme, getImeSnapshot)
}

export function useAndroidInsets() {
  useEffect(() => {
    let disposed = false
    let removeScrollLock: (() => void) | null = null

    api.getPlatform().then((p) => {
      if (p !== 'android' || disposed) return
      api.getWindowInsets().then((i) => { if (!disposed) applyInsets(i) }).catch(() => {})

      const resetScroll = () => { window.scrollTo(0, 0) }
      window.addEventListener('scroll', resetScroll, { passive: true })
      removeScrollLock = () => window.removeEventListener('scroll', resetScroll)
    })
    const un = listen<NativeInsets>('insets-changed', (e) => applyInsets(e.payload))
    return () => {
      disposed = true
      un.then((fn) => fn())
      removeScrollLock?.()
    }
  }, [])
}
