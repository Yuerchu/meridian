import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/api'
import { encodePcm16Base64, openCapture, type CaptureHandle } from '@/lib/web-audio-capture'
import type { VoiceButtonState } from '@/components/ui/voice-button'
import type { VoiceNotice } from './use-voice-recorder'

/** Below this a press is a tap: focus the field and let the keyboard up. */
const HOLD_THRESHOLD_MS = 300
/** Hard stop, matching the familiar voice-message cap. */
const MAX_DURATION_MS = 60_000
/** Upward travel that arms the cancel. Well past the scroll slop, and about a
 *  thumb's reach so it can be done without looking. */
const CANCEL_SLIDE_PX = 60

export type AndroidVoiceState = VoiceButtonState | 'cancelling'

interface Options {
  onSend: (text: string) => void
  onNotice: (notice: VoiceNotice, detail?: string) => void
  /** Called on a short press, to hand the field back to the keyboard. */
  onTap: () => void
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
 */
export function useAndroidVoiceRecorder({ onSend, onNotice, onTap }: Options) {
  const [state, setState] = useState<AndroidVoiceState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [peak, setPeak] = useState(0)

  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const handleRef = useRef<CaptureHandle | null>(null)
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
      const result = await api.voiceTranscribePcm(
        captured.sampleRate,
        encodePcm16Base64(captured.samples),
      )
      if (result.status === 'ok') onSend(result.text)
      else onNotice(result.status)
    } catch (e) {
      onNotice('error', String(e))
    }
    setState('idle')
    setElapsed(0)
  }, [onNotice, onSend, release])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (stateRef.current !== 'idle') return
    e.currentTarget.setPointerCapture(e.pointerId)
    cancelledRef.current = false
    pressedAtRef.current = Date.now()
    startYRef.current = e.clientY
    setState('starting')

    // Both slow things start now: the device, and the 149MB encoder behind the
    // first transcription. Talking covers them.
    api.voicePrewarm().catch(() => {})
    const opening = openCapture({ onPeak: (p) => { peakRef.current = p } })
    opening.then(
      (handle) => {
        // The press may already be over, or cancelled, by the time this lands.
        if (cancelledRef.current || stateRef.current === 'idle') {
          handle.cancel()
          return
        }
        handleRef.current = handle
        // Only now does audio start being kept: whatever the device produced
        // while it was warming up belongs to nobody.
        if (stateRef.current === 'recording-hold' || stateRef.current === 'cancelling') {
          handle.beginCollecting()
          captureAtRef.current = Date.now()
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
      if (cancelledRef.current || stateRef.current !== 'starting') return
      setState('recording-hold')
      navigator.vibrate?.(15)
      captureAtRef.current = Date.now()
      handleRef.current?.beginCollecting()
    }, HOLD_THRESHOLD_MS)
  }, [onNotice, release])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const s = stateRef.current
    if (s !== 'recording-hold' && s !== 'cancelling') return
    const slid = startYRef.current - e.clientY
    if (slid > CANCEL_SLIDE_PX && s !== 'cancelling') {
      setState('cancelling')
      navigator.vibrate?.(10)
    } else if (slid <= CANCEL_SLIDE_PX && s === 'cancelling') {
      setState('recording-hold')
    }
  }, [])

  const handlePointerUp = useCallback(() => {
    const s = stateRef.current
    if (s === 'idle' || s === 'transcribing') return

    if (s === 'cancelling') {
      cancel()
      return
    }
    // Short press: never became a recording. Hand the field to the keyboard.
    if (Date.now() - pressedAtRef.current < HOLD_THRESHOLD_MS) {
      cancel()
      onTap()
      return
    }
    // Held, but the device never opened in time — there is nothing to send.
    if (!handleRef.current) {
      cancel()
      onNotice('too_short')
      return
    }
    finish()
  }, [cancel, finish, onNotice, onTap])

  const handlePointerCancel = useCallback(() => cancel(), [cancel])

  // The ticker drives the clock, the level meter and the hard cap.
  //
  // It must not depend on `finish` or `cancel`. Those close over `onSend`,
  // which callers write inline and therefore replace on every render — and the
  // meter re-renders constantly — so an effect keyed on them tears down and
  // rebuilds the interval faster than it can fire. That is why the clock read
  // 0:00 for the whole recording.
  const liveRef = useRef({ finish, cancel })
  useEffect(() => { liveRef.current = { finish, cancel } }, [finish, cancel])

  const capturing = state === 'recording-hold' || state === 'cancelling'
  useEffect(() => {
    if (!capturing) return
    const onHidden = () => { if (document.hidden) liveRef.current.cancel() }
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
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  }
}
