import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api'
import type { VoiceButtonState } from '@/components/ui/voice-button'

/** Press shorter than this is a click → switch to toggle mode; longer means
 *  hold-to-talk and release stops the recording. Measured from pointerdown, not
 *  from when the device opens, so the gesture reads the same either way. */
const HOLD_THRESHOLD_MS = 300
/** Hard stop, matching the familiar voice-message cap. */
const MAX_DURATION_MS = 60_000

export type VoiceNotice = 'too_short' | 'empty' | 'model_missing' | 'error'

/** States in which a recording is under way or being set up. */
const LIVE_STATES: VoiceButtonState[] = ['starting', 'recording-hold', 'recording-toggle']

interface UseVoiceRecorderOptions {
  onSend: (text: string) => void
  onNotice: (notice: VoiceNotice, detail?: string) => void
}

export function useVoiceRecorder({ onSend, onNotice }: UseVoiceRecorderOptions) {
  const [state, setState] = useState<VoiceButtonState>('idle')
  const [elapsed, setElapsed] = useState(0)
  /** When the button went down — drives the hold-vs-click decision. */
  const pressedAtRef = useRef(0)
  /** When the microphone actually started capturing — drives the timer, so the
   *  number on screen is the audio the model will receive. */
  const captureAtRef = useRef(0)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  /** A very fast tap can try to stop before the start call has resolved;
   *  awaiting this in `finish`/`cancel` keeps the calls strictly ordered. */
  const startPromiseRef = useRef<Promise<void> | null>(null)

  const finish = useCallback(async () => {
    if (!LIVE_STATES.includes(stateRef.current)) return
    setState('transcribing')
    try {
      await startPromiseRef.current
    } catch {
      // Start already failed and reported; nothing to stop.
      setState('idle')
      return
    }
    try {
      const result = await api.voiceStopAndTranscribe()
      if (result.status === 'ok') {
        onSend(result.text)
      } else {
        onNotice(result.status)
      }
    } catch (e) {
      onNotice('error', String(e))
    }
    setState('idle')
  }, [onSend, onNotice])

  const cancel = useCallback(() => {
    if (!LIVE_STATES.includes(stateRef.current)) return
    setState('idle')
    const started = startPromiseRef.current
    void (async () => {
      try {
        await started
      } catch {
        return // start failed; no session to cancel
      }
      api.voiceCancelRecording().catch(console.error)
    })()
  }, [])

  const handlePointerDown = useCallback(
    async (e: React.PointerEvent) => {
      // Narrow a copy, not the ref itself: narrowing the ref would follow it past
      // the await below, where its value can legitimately have changed.
      const before = stateRef.current
      if (before === 'recording-toggle') {
        // Second click ends a toggle-mode recording; act on press for snappiness.
        finish()
        return
      }
      if (before !== 'idle') return

      e.currentTarget.setPointerCapture(e.pointerId)
      pressedAtRef.current = Date.now()
      // Not 'recording-*' yet: opening the input device takes a moment, and
      // showing a live recording indicator during it invites the user to start
      // talking into a microphone that is not capturing. The opening words were
      // getting cut off that way.
      setState('starting')
      startPromiseRef.current = api.voiceStartRecording()
      try {
        await startPromiseRef.current
        captureAtRef.current = Date.now()
        // A release or cancel may have landed while the device was opening; only
        // promote to a live state if we are still waiting for one.
        if (stateRef.current === 'starting') setState('recording-hold')
      } catch (err) {
        setState('idle')
        const msg = String(err)
        onNotice(msg.includes('model_not_installed') ? 'model_missing' : 'error', msg)
      }
    },
    [finish, onNotice],
  )

  const handlePointerUp = useCallback(() => {
    // 'starting' counts as held: the intent is established even if the device
    // is still opening, and `finish` waits for the start call before stopping.
    if (stateRef.current !== 'recording-hold' && stateRef.current !== 'starting') return
    if (Date.now() - pressedAtRef.current < HOLD_THRESHOLD_MS) {
      // Short press: keep recording, wait for the closing click.
      setState('recording-toggle')
    } else {
      finish()
    }
  }, [finish])

  const handlePointerCancel = useCallback(() => {
    cancel()
  }, [cancel])

  // Opening an input device is slow enough to swallow the first word of someone
  // who clicks and talks straight away, so it happens on approach instead. Both
  // calls are advisory: prewarm failures are silent, and releasing only ever
  // drops a device that is idling.
  const handlePointerEnter = useCallback(() => {
    if (stateRef.current === 'idle') api.voicePrewarm().catch(() => {})
  }, [])

  const handlePointerLeave = useCallback(() => {
    if (stateRef.current === 'idle') api.voiceReleasePrewarm().catch(() => {})
  }, [])

  // Escape cancels; the timer drives the elapsed display and the 60s cap.
  const live = LIVE_STATES.includes(state)
  const capturing = state === 'recording-hold' || state === 'recording-toggle'
  useEffect(() => {
    if (!live) {
      setElapsed(0)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    document.addEventListener('keydown', onKey)
    if (!capturing) {
      // Device still opening: Esc must work, but there is nothing to time yet.
      return () => document.removeEventListener('keydown', onKey)
    }
    const timer = setInterval(() => {
      const ms = Date.now() - captureAtRef.current
      setElapsed(ms / 1000)
      if (ms >= MAX_DURATION_MS) finish()
    }, 250)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearInterval(timer)
    }
  }, [live, capturing, cancel, finish])

  return {
    state,
    elapsed,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel,
    handlePointerEnter,
    handlePointerLeave,
  }
}
