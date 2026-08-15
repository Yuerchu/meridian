import { useCallback, useEffect, useState } from 'react'

import { api } from '@/api'

const KEY = 'android.hold_to_talk'

/**
 * Whether holding the composer itself starts a recording.
 *
 * A switch rather than a decision because the decision needs a phone to make.
 * The layer that catches the hold sits over the text field, and a WebView is
 * not obliged to raise a keyboard for a focus it was handed by script rather
 * than by a finger — so on some devices the gesture costs typing altogether.
 * Turning it off gives the field back: taps land on a real textarea and Android
 * opens the keyboard itself, with hold-to-talk left to the microphone button
 * that has always been in the toolbar beside it.
 *
 * Absent means on, which is what it has been since it was written.
 */
export function useHoldToTalk(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    let cancelled = false
    api.getPreference(KEY)
      .then((v) => { if (!cancelled) setEnabled(v !== 'false') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const set = useCallback((next: boolean) => {
    setEnabled(next)
    api.setPreference(KEY, next ? 'true' : 'false').catch(() => {})
  }, [])

  return [enabled, set]
}
