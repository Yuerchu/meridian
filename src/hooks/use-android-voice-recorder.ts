import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/api'
import { encodePcm16Base64, openCapture, type CaptureHandle } from '@/lib/web-audio-capture'
import type { VoiceButtonState } from '@/components/ui/voice-button'
import type { VoiceNotice } from './use-voice-recorder'

/** Below this a press is a tap, which starts nothing. */
const HOLD_THRESHOLD_MS = 300
/** Hard stop, matching the familiar voice-message cap. */
const MAX_DURATION_MS = 60_000
/** Upward travel that arms the cancel. Well past the scroll slop, and about a
 *  thumb's reach so it can be done without looking. */
const CANCEL_SLIDE_PX = 60
/** Travel before the hold commits that means the finger was going somewhere
 *  else. The gesture is handed back rather than held onto. */
const SCROLL_SLOP_PX = 10

export type AndroidVoiceState = VoiceButtonState | 'cancelling'

interface Options {
  onSend: (text: string) => void
  onNotice: (notice: VoiceNotice, detail?: string) => void
  /** Whether holding the field starts a recording at this moment. */
  enabled: boolean
}

/**
 * Hold-to-talk on the composer itself.
 *
 * Separate from `useVoiceRecorder` rather than a branch inside it: that one
 * drives a recording session in Rust, this one drives a MediaStream in the
 * page, and past the shared vocabulary they have no logic in common.
 *
 * The press starts the microphone immediately and only commits to recording
 * once it has lasted long enough to be a hold. Opening a device is slow and
 * wildly variable — 141ms to 2.6s on the same phone within a minute — so the
 * threshold doubles as the warm-up window, and everything captured before the
 * commit is discarded.
 *
 * # Why the field and not a layer over it
 *
 * This began as an absolutely-positioned layer, and that layer cost Android
 * typing outright. The reason is a matter of order, not of focus: a tap's
 * default action is dispatched *after* the handlers for the touch that produced
 * it, because the gesture is only recognised once the touch sequence goes
 * unconsumed. So `focus()` in `pointerup` did reach the IME — and then the tap
 * landed on a `role="button"` div, which cannot hold focus, moved focus to the
 * body, and Chromium reported `textInputType == NONE`, whose handling is to
 * hide the keyboard. Every press played a keyboard opening and closing again.
 *
 * Doing it on the field inverts the problem. A short press is left completely
 * alone, so the platform's own path — tap an editable element, focus it, raise
 * the IME — runs untouched, and no script is involved in the one thing script
 * turned out not to be able to do. Only the hold is intercepted, by cancelling
 * the touch that would otherwise become that tap.
 *
 * # Why native listeners
 *
 * React attaches `touchstart` and `touchmove` passively at the root, where
 * `preventDefault()` on the synthetic event is ignored — silently, with nothing
 * for tsc or eslint to catch. `attachField` binds the real element instead.
 * Touch also captures implicitly to the `touchstart` target, so there is no
 * `setPointerCapture` here and no need for one.
 */
export function useAndroidVoiceRecorder({ onSend, onNotice, enabled }: Options) {
  const [state, setState] = useState<AndroidVoiceState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [peak, setPeak] = useState(0)

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const handleRef = useRef<CaptureHandle | null>(null)
  /**
   * Whether a finger is currently down, set synchronously.
   *
   * `stateRef` cannot answer this: it is updated from an effect, so it trails
   * the render by a commit. Opening the device takes anywhere from 141ms to
   * 2.6s and blocks that commit, so a tap could arrive at the release with the
   * state still reading `idle` — the release returned early, and the hold timer
   * then promoted a press that was already over. That is a recording nobody
   * started and nothing would stop.
   */
  const pressActiveRef = useRef(false)
  /**
   * Whether the press has outlasted the threshold and taken the gesture.
   *
   * Read inside the touch listeners, which have to decide *within the event*
   * whether to cancel it — after the handler returns it is too late.
   */
  const committedRef = useRef(false)
  const pressedAtRef = useRef(0)
  const captureAtRef = useRef(0)
  const startYRef = useRef(0)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)
  /** Peak arrives every audio block — roughly every 8ms at 16kHz. Storing it in
   *  state would re-render the whole composer that often; the ticker below
   *  samples it instead. */
  const peakRef = useRef(0)

  /** Every exit runs through here. A leaked stream leaves the system microphone
   *  indicator lit, which reads as spying. */
  const release = useCallback(() => {
    pressActiveRef.current = false
    committedRef.current = false
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    handleRef.current?.cancel()
    handleRef.current = null
    peakRef.current = 0
    setState('idle')
    setElapsed(0)
    setPeak(0)
  }, [])

  useEffect(() => release, [release])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    release()
  }, [release])

  const finish = useCallback(async () => {
    const handle = handleRef.current
    if (!handle) return release()

    handleRef.current = null
    committedRef.current = false
    pressActiveRef.current = false
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setState('transcribing')
    setPeak(0)

    let captured: { samples: Float32Array; sampleRate: number }
    try {
      captured = handle.stop()
    } catch (e) {
      release()
      onNotice('error', String(e))
      return
    }

    try {
      const result = await api.voiceTranscribePcm(captured.sampleRate, encodePcm16Base64(captured.samples))
      if (result.status === 'ok') onSend(result.text)
      else onNotice(result.status)
    } catch (e) {
      onNotice('error', String(e))
    }
    setState('idle')
    setElapsed(0)
  }, [onNotice, onSend, release])

  const beginPress = useCallback(
    (clientY: number) => {
      if (stateRef.current !== 'idle' || pressActiveRef.current) return
      pressActiveRef.current = true
      committedRef.current = false
      cancelledRef.current = false
      pressedAtRef.current = Date.now()
      startYRef.current = clientY

      // Deliberately no `setState` here. The overlay is drawn for every state but
      // `idle`, so announcing the press on the way down put "Preparing…" over
      // half the screen for every tap on the composer — including the taps that
      // were only ever going to be someone reaching for the keyboard. Nothing is
      // said until the press has lasted long enough to be a hold.
      //
      // Both slow things still start now: the device, and the 149MB encoder
      // behind the first transcription. Talking covers them.
      api.voicePrewarm().catch(() => {})
      const opening = openCapture({
        onPeak: (p) => {
          peakRef.current = p
        },
      })
      opening.then(
        (handle) => {
          // The press may already be over, or cancelled, by the time this lands.
          if (cancelledRef.current || !pressActiveRef.current) {
            handle.cancel()
            return
          }
          handleRef.current = handle
          // Only now does audio start being kept: whatever the device produced
          // while it was warming up belongs to nobody. If the hold threshold has
          // already passed, the recording has been waiting for this.
          if (stateRef.current === 'starting') {
            setState('recording-hold')
            captureAtRef.current = Date.now()
            handle.beginCollecting()
          }
        },
        (err) => {
          if (cancelledRef.current) return
          release()
          onNotice('error', String(err))
        },
      )

      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null
        // `pressActiveRef` and not the state: a release that beat the state into
        // place must not be promoted into a recording behind the user's back.
        if (cancelledRef.current || !pressActiveRef.current) return
        committedRef.current = true
        navigator.vibrate?.(15)
        // The device usually wins this race, but not always — it has taken 2.6s
        // on the same phone that managed 141ms a minute earlier. `starting` is
        // what the overlay says while the two are out of step.
        if (handleRef.current) {
          setState('recording-hold')
          captureAtRef.current = Date.now()
          handleRef.current.beginCollecting()
        } else {
          setState('starting')
        }
      }, HOLD_THRESHOLD_MS)
    },
    [onNotice, release],
  )

  const movePress = useCallback(
    (clientY: number) => {
      if (!pressActiveRef.current) return
      const slid = startYRef.current - clientY
      // Before the hold commits, travel means the finger was on its way somewhere
      // else. Give the gesture back rather than turning a scroll into a recording.
      if (!committedRef.current) {
        if (Math.abs(slid) > SCROLL_SLOP_PX) cancel()
        return
      }
      const s = stateRef.current
      if (s !== 'recording-hold' && s !== 'cancelling') return
      if (slid > CANCEL_SLIDE_PX && s !== 'cancelling') {
        setState('cancelling')
        navigator.vibrate?.(10)
      } else if (slid <= CANCEL_SLIDE_PX && s === 'cancelling') {
        setState('recording-hold')
      }
    },
    [cancel],
  )

  const endPress = useCallback(() => {
    if (!pressActiveRef.current) return
    pressActiveRef.current = false

    if (stateRef.current === 'cancelling') {
      cancel()
      return
    }
    // Short press: never became a recording, and never said so. Someone is
    // reaching for the keyboard and the platform is already handling it —
    // saying anything here would answer a question nobody asked. Measured
    // against the clock rather than the state, which may not have caught up
    // with the press yet.
    if (Date.now() - pressedAtRef.current < HOLD_THRESHOLD_MS) {
      cancel()
      return
    }
    // Held, but the device never opened in time — there is nothing to send.
    if (!handleRef.current) {
      cancel()
      onNotice('too_short')
      return
    }
    finish()
  }, [cancel, finish, onNotice])

  /**
   * Binds the gesture to the text field.
   *
   * Returns nothing and is safe to call again with the same element or with
   * `null`; the previous binding is always torn down first.
   */
  const detachRef = useRef<(() => void) | null>(null)
  const attachField = useCallback(
    (el: HTMLTextAreaElement | null) => {
      detachRef.current?.()
      detachRef.current = null
      if (!el) return

      const onTouchStart = (e: TouchEvent) => {
        // One finger only: a second is a pinch, or a mis-grip.
        if (!enabledRef.current || e.touches.length !== 1) return
        beginPress(e.touches[0].clientY)
        // Not prevented. The tap this may become is how the keyboard opens, and
        // it is only worth taking away once the press has proved to be a hold.
      }
      const onTouchMove = (e: TouchEvent) => {
        if (!pressActiveRef.current) return
        movePress(e.touches[0]?.clientY ?? 0)
        // Committed means the finger belongs to the recording: the slide up to
        // cancel must not also scroll the transcript.
        if (committedRef.current && e.cancelable) e.preventDefault()
      }
      const onTouchEnd = (e: TouchEvent) => {
        const held = committedRef.current
        endPress()
        // Cancelling the touch is what stops it becoming a tap — no focus change,
        // no keyboard, no text-selection handles. Only for a press that actually
        // recorded something; anything shorter is left to the platform.
        if (held && e.cancelable) e.preventDefault()
      }
      const onTouchCancel = () => cancel()
      // The native long-press menu would arrive at ~500ms, after the hold has
      // already committed at 300. Suppressed only while a press is live, so a
      // field with text in it keeps the system paste bar — on a phone that is the
      // only way to reach the clipboard.
      const onContextMenu = (e: Event) => {
        if (pressActiveRef.current) e.preventDefault()
      }

      el.addEventListener('touchstart', onTouchStart, { passive: false })
      el.addEventListener('touchmove', onTouchMove, { passive: false })
      el.addEventListener('touchend', onTouchEnd, { passive: false })
      el.addEventListener('touchcancel', onTouchCancel)
      el.addEventListener('contextmenu', onContextMenu)

      detachRef.current = () => {
        el.removeEventListener('touchstart', onTouchStart)
        el.removeEventListener('touchmove', onTouchMove)
        el.removeEventListener('touchend', onTouchEnd)
        el.removeEventListener('touchcancel', onTouchCancel)
        el.removeEventListener('contextmenu', onContextMenu)
      }
    },
    [beginPress, cancel, endPress, movePress],
  )

  useEffect(
    () => () => {
      detachRef.current?.()
    },
    [],
  )

  // The ticker drives the clock, the level meter and the hard cap.
  //
  // It must not depend on `finish` or `cancel`. Those close over `onSend`,
  // which callers write inline and therefore replace on every render — and the
  // meter re-renders constantly — so an effect keyed on them tears down and
  // rebuilds the interval faster than it can fire. That is why the clock read
  // 0:00 for the whole recording.
  const liveRef = useRef({ finish, cancel })
  useEffect(() => {
    liveRef.current = { finish, cancel }
  }, [finish, cancel])

  const capturing = state === 'recording-hold' || state === 'cancelling'
  useEffect(() => {
    if (!capturing) return
    const onHidden = () => {
      if (document.hidden) liveRef.current.cancel()
    }
    document.addEventListener('visibilitychange', onHidden)
    const timer = setInterval(() => {
      setPeak(peakRef.current)
      const ms = Date.now() - captureAtRef.current
      setElapsed(ms / 1000)
      if (ms >= MAX_DURATION_MS) liveRef.current.finish()
    }, 100)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      clearInterval(timer)
    }
  }, [capturing])

  return {
    state,
    elapsed,
    peak,
    isActive: state !== 'idle',
    cancel,
    attachField,
  }
}
