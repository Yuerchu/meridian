import { useTranslation } from 'react-i18next'
import { Microphone, TrashBin } from '@gravity-ui/icons'

import { cx } from '@/utils/cx'
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
  const statusText = starting
    ? t('chat.voice.preparing')
    : transcribing
      ? t('chat.voice.transcribing')
      : cancelling
        ? t('chat.voice.releaseToCancel')
        : t('chat.voice.releaseToSend')

  return (
    <div
      data-slot="voice-overlay"
      // Covers the lower half rather than floating a small card: the thumb is
      // down there, and the feedback has to be readable around it.
      //
      // A gradient rather than a fill, fading out towards the top: a hard edge
      // across the middle of the screen is a lot of light to raise at night,
      // and the words only need to be legible where they are.
      //
      // Not `--accent`. That is the *action* colour, and it inverts between
      // themes so a button fill stays contrasty — near-black on light, near
      // *white* on dark. Half a phone screen of it at 2am is a flashbang. The
      // danger red does not invert, being a hue rather than a lightness, which
      // is why cancelling was never the complaint.
      // The bottom padding carries the keyboard. This is `fixed`, so it is
      // outside the shell that `app-shell` pads with `--ime-bottom` — and a
      // flat `pb-24` put the level meter and "release to send" underneath an
      // open keyboard, which is exactly the case where the field was focused
      // and someone then held the button. The variable is set on `<html>`
      // (`use-android-insets`), so anything portalled can still read it, and it
      // is undefined everywhere but Android — hence the fallback.
      className={cx(
        'pointer-events-none fixed inset-x-0 bottom-0 z-50 flex h-1/2 flex-col items-center justify-end gap-6',
        'pb-[calc(6rem+var(--ime-bottom,0px))]',
        'bg-gradient-to-t',
        cancelling
          ? 'from-status-danger via-status-danger/80 to-transparent text-status-danger-foreground'
          : 'from-background-primary-default via-background-primary-default/85 to-transparent text-text-primary',
      )}
    >
      {/* Only state transitions are announced. The timer and level meter update
          continuously and would otherwise restart polite announcements. */}
      <span data-slot="voice-overlay-status" className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>
      <div data-slot="voice-overlay-state" className="flex flex-col items-center gap-3">
        {cancelling ? <TrashBin className="size-8" /> : <Microphone className="size-8" />}
        <span data-slot="voice-overlay-label" aria-hidden="true" className="text-headline-medium">
          {statusText}
        </span>
      </div>

      {/* Level meter. Not decoration: without it a silent transcript leaves no
          way to tell a dead microphone from a bad recogniser. */}
      {(state === 'recording-hold' || cancelling) && (
        <>
          <div data-slot="voice-overlay-meter" aria-hidden="true" className="flex h-10 items-center gap-1">
            {Array.from({ length: 21 }, (_, i) => {
              const distance = Math.abs(i - 10) / 10
              const height = Math.max(0.1, Math.min(1, peak * 2.4 * (1 - distance * 0.6)))
              return (
                <span
                  key={i}
                  data-slot="voice-overlay-meter-bar"
                  className="h-full w-1 origin-center rounded-full bg-current transition-transform duration-75 motion-reduce:transition-none"
                  style={{ transform: `scaleY(${height})`, opacity: cancelling ? 0.5 : 0.9 }}
                />
              )
            })}
          </div>
          <span
            data-slot="voice-overlay-timer"
            aria-hidden="true"
            className="text-body-regular tabular-nums opacity-80"
          >
            {remaining <= 10
              ? t('chat.voice.secondsLeft', { count: remaining })
              : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
          </span>
        </>
      )}
    </div>
  )
}
