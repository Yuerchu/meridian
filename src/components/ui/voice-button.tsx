import { Mic } from '@keyline-icons/react/two-tone'
import { Stop } from '@keyline-icons/react/fill'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import './voice-button.css'

export type VoiceButtonState =
  | 'idle'
  /** Opening the audio device. Shown distinctly so the user does not start
   *  talking before the microphone is actually capturing. */
  | 'starting'
  | 'recording-hold'
  | 'recording-toggle'
  | 'transcribing'

interface VoiceButtonProps {
  state: VoiceButtonState
  /** Named by the caller, which is where the state-dependent wording lives. */
  'aria-label'?: string
  /** Seconds recorded so far; shown while recording. */
  elapsed?: number
  disabled?: boolean
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  onPointerCancel?: (e: React.PointerEvent) => void
  /** Approach and departure drive microphone prewarming. */
  onPointerEnter?: (e: React.PointerEvent) => void
  onPointerLeave?: (e: React.PointerEvent) => void
  /** Enter/Space use toggle recording; pointer gestures keep hold-to-talk. */
  onKeyboardPress?: () => void
}

/** Presentational only — all gesture logic lives in `useVoiceRecorder`, so
 *  this stays renderable in the browser playground without a Tauri backend. */
export function VoiceButton({
  state,
  'aria-label': ariaLabel,
  elapsed = 0,
  disabled,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerEnter,
  onPointerLeave,
  onKeyboardPress,
}: VoiceButtonProps) {
  const recording = state === 'recording-hold' || state === 'recording-toggle'

  return (
    <div data-slot="voice-button" data-state={state} data-recording={recording || undefined} className="m-voice-button">
      {recording && (
        <span data-slot="voice-button-elapsed" className="m-voice-button__elapsed">
          {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}
        </span>
      )}
      <TooltipTrigger>
        {/* The composer's round control, red while it is listening. */}
        <Button
          variant="secondary"
          icon={state === 'recording-toggle' ? <Stop /> : <Mic />}
          aria-label={ariaLabel}
          aria-pressed={recording}
          isDisabled={disabled}
          isPending={state === 'transcribing'}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onPress={(event) => {
            // React Aria reports screen-reader and other programmatic activation
            // as `virtual`; unlike mouse/touch/pen it has no pointer handler that
            // could otherwise start recording.
            if (event.pointerType === 'keyboard' || event.pointerType === 'virtual') onKeyboardPress?.()
          }}
          // Keep focus in the textarea; the browser default would steal it.
          onMouseDown={(e) => e.preventDefault()}
        />
        <Tooltip>{ariaLabel}</Tooltip>
      </TooltipTrigger>
    </div>
  )
}
