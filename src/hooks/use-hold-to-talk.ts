import { useCallback, useEffect, useState } from 'react'

import { api } from '@/api'

const KEY = 'android.hold_to_talk'

/**
 * Shared across every caller rather than one `useState` each.
 *
 * The switch lives in Settings and the layer it governs lives in the composer,
 * and those are mounted at the same time — `chat-view` does not unmount because
 * someone opened Settings. With per-hook state the composer would keep whatever
 * it read when it mounted, so turning the switch off changed nothing until the
 * app was restarted, which reads as the switch not working at all.
 */
let value = true
let loaded = false
const listeners = new Set<(v: boolean) => void>()

function publish(next: boolean) {
  value = next
  for (const l of listeners) l(next)
}

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
  const [enabled, setEnabled] = useState(value)

  useEffect(() => {
    listeners.add(setEnabled)
    if (!loaded) {
      loaded = true
      api.getPreference(KEY)
        .then((v) => publish(v !== 'false'))
        .catch(() => {})
    }
    return () => { listeners.delete(setEnabled) }
  }, [])

  const set = useCallback((next: boolean) => {
    publish(next)
    api.setPreference(KEY, next ? 'true' : 'false').catch(() => {})
  }, [])

  return [enabled, set]
}
