import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A flag that raises itself and falls back down on its own.
 *
 * Every "Saved ✓" and "Copied ✓" in the app is this, and every one of them was
 * `setFlag(true); setTimeout(() => setFlag(false), 2000)` written out again —
 * which gets two things wrong that only show up when someone is quick.
 *
 * Press save twice inside the window and the first timer is still running: it
 * fires against the second press and takes the tick away early, so the second
 * save looks like it did not happen. Starting a new timer has to cancel the old
 * one. And a panel closed before the window is out leaves a timer holding a
 * setter for a component that is gone.
 *
 * Both are fixed here once. The only call site that had them right was OneBot's,
 * which is where this comes from.
 */
export function useTemporaryFlag(ms = 2000): [boolean, () => void, () => void] {
  const [raised, setRaised] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(() => stop, [stop])

  const raise = useCallback(() => {
    setRaised(true)
    stop()
    timer.current = setTimeout(() => setRaised(false), ms)
  }, [ms, stop])

  /**
   * Take it down early. Only for when what it was confirming stops being true
   * before the window is out — General switches search provider that way, where
   * a leftover tick would claim a key had been saved for the wrong one.
   */
  const lower = useCallback(() => {
    stop()
    setRaised(false)
  }, [stop])

  return [raised, raise, lower]
}
