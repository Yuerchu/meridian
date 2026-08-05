import { Mic, Square } from 'lucide-react'
import { Button, Spinner } from '@heroui/react'
import { cn } from '@/lib/utils'

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
  /** Seconds recorded so far; shown while recording. */
  elapsed?: number
  disabled?: boolean
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  onPointerCancel?: (e: React.PointerEvent) => void
  /** Approach and departure drive microphone prewarming. */
  onPointerEnter?: (e: React.PointerEvent) => void
  onPointerLeave?: (e: React.PointerEvent) => void
}

/** Presentational only — all gesture logic lives in `useVoiceRecorder`, so
 *  this stays renderable in the browser playground without a Tauri backend. */
export function VoiceButton({
  state,
  elapsed = 0,
  disabled,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerEnter,
  onPointerLeave,
}: VoiceButtonProps) {
  const recording = state === 'recording-hold' || state === 'recording-toggle'

  return (
    <div data-slot="voice-button" className="flex items-center gap-1.5">
      {recording && (
        <span className="text-xs tabular-nums text-danger select-none">
          {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}
        </span>
      )}
      <Button
        isIconOnly
        variant="ghost"
        isDisabled={disabled || state === 'transcribing'}
        className={cn(
          'touch-hitbox touch-none select-none',
          recording && 'text-danger hover:text-danger animate-pulse',
          state === 'starting' && 'text-muted/40',
          state !== 'starting' && !recording && 'text-muted hover:text-foreground',
        )}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        // Keep focus in the textarea; the browser default would steal it.
        onMouseDown={(e) => e.preventDefault()}
      >
        {state === 'transcribing' ? (
          <Spinner className="w-4 h-4" />
        ) : state === 'recording-toggle' ? (
          <Square className="w-4 h-4" fill="currentColor" />
        ) : (
          <Mic className="w-4 h-4" />
        )}
      </Button>
    </div>
  )
}
