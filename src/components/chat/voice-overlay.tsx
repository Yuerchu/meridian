import { useTranslation } from 'react-i18next'
import { Microphone, TrashBin } from '@gravity-ui/icons'

import { cn } from '@/lib/utils'
import type { AndroidVoiceState } from '@/hooks/use-android-voice-recorder'

interface VoiceOverlayProps {
  state: AndroidVoiceState
  /** Seconds of audio actually kept. */
  elapsed: number
  /** Latest block peak, 0..1. */
  peak: number
}

/**
 * What appears while holding to talk.
 *
 * Fixed to the middle of the screen rather than positioned against the
 * composer: the finger is on the composer and would cover anything drawn there,
 * and anchoring to an ancestor made the layout depend on which element happened
 * to establish the containing block.
 *
 * No `backdrop-filter`, and no translucent fills over it. Android's WebView
 * composites those unreliably — the symptom here was the whole page going black
 * on press — and this project has already been bitten by the same class of bug
 * on WebView2. Solid colours only.
 *
 * Purely presentational; the gesture lives in `useAndroidVoiceRecorder`.
 */
export function VoiceOverlay({ state, elapsed, peak }: VoiceOverlayProps) {
  const { t } = useTranslation()
  if (state === 'idle') return null

  const cancelling = state === 'cancelling'
  const starting = state === 'starting'
  const transcribing = state === 'transcribing'

  const seconds = Math.floor(elapsed)
  const remaining = 60 - seconds

  return (
    <div
      data-slot="voice-overlay"
      // Covers the lower half rather than floating a small card: the thumb is
      // down there, and the feedback has to be readable around it.
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-50 flex h-1/2 flex-col items-center justify-end gap-6 pb-24',
        cancelling ? 'bg-danger text-white' : 'bg-accent text-accent-foreground',
      )}
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        {cancelling ? (
          <TrashBin className="size-8" />
        ) : (
          <Microphone className="size-8" />
        )}
        <span className="text-base font-medium">
          {starting
            ? t('chat.voice.preparing')
            : transcribing
              ? t('chat.voice.transcribing')
              : cancelling
                ? t('chat.voice.releaseToCancel')
                : t('chat.voice.releaseToSend')}
        </span>
      </div>

      {/* Level meter. Not decoration: without it a silent transcript leaves no
          way to tell a dead microphone from a bad recogniser. */}
      {(state === 'recording-hold' || cancelling) && (
        <>
          <div className="flex h-10 items-center gap-1">
            {Array.from({ length: 21 }, (_, i) => {
              const distance = Math.abs(i - 10) / 10
              const height = Math.max(0.1, Math.min(1, peak * 2.4 * (1 - distance * 0.6)))
              return (
                <span
                  key={i}
                  className="w-1 rounded-full bg-current transition-[height] duration-75"
                  style={{ height: `${height * 100}%`, opacity: cancelling ? 0.5 : 0.9 }}
                />
              )
            })}
          </div>
          <span className="text-sm tabular-nums opacity-80">
            {remaining <= 10
              ? t('chat.voice.secondsLeft', { count: remaining })
              : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
          </span>
        </>
      )}
    </div>
  )
}
