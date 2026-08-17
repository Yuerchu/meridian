import { useEffect, useState } from 'react'

import { PLAIN, ensureLanguage, isReady, resolveLanguage } from '@/lib/shiki'

/**
 * Resolves a language label and loads its grammar, reporting when highlighting
 * can proceed.
 *
 * The grammar arrives asynchronously but colours synchronously, so callers get
 * a boolean rather than a promise: render plain until it flips, then highlight
 * inline as many times as they like. A diff calls it once and colours every one
 * of its lines from the answer.
 */
export function useShikiLanguage(label: string | null | undefined): { language: string; ready: boolean } {
  const language = resolveLanguage(label)
  const [ready, setReady] = useState(() => isReady(language))

  useEffect(() => {
    if (isReady(language)) {
      setReady(true)
      return
    }
    setReady(false)
    let alive = true
    void ensureLanguage(language).then(() => {
      if (alive) setReady(isReady(language))
    })
    return () => {
      alive = false
    }
  }, [language])

  return { language, ready: ready && language !== PLAIN }
}
