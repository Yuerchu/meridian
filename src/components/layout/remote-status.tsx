import { useTranslation } from 'react-i18next'

import { useConnectionState } from '@/hooks/use-connection-state'
import { isRemote } from '@/lib/transport'
import { cx } from '@/utils/cx'

/**
 * Whether the machine answering this window is still there.
 *
 * Nothing at all while it is — a badge that says "connected" for hours is a
 * badge nobody reads by the time it matters, and the states that need saying
 * are the two that change what the app will let you do. Offline is drawn in
 * `--danger` rather than `--warning` because it is not a degradation: the
 * composer is disabled underneath it and no turn can be started.
 *
 * `role="status"` so the change is announced once, without moving focus.
 */
export function RemoteStatus() {
  const { t } = useTranslation()
  const state = useConnectionState()

  if (!isRemote || state === 'connected') return null
  const offline = state === 'offline'

  return (
    <span
      data-slot="remote-status"
      role="status"
      className={cx(
        'flex shrink-0 items-center gap-1.5 text-xs',
        offline ? 'text-status-danger' : 'text-status-warning-soft-foreground',
      )}
    >
      {/* The word beside it says the same thing, so announcing the dot too
          would only say it twice. */}
      <span
        data-slot="remote-status-dot"
        aria-hidden
        className={cx(
          'size-1.5 rounded-full',
          // eslint-disable-next-line no-restricted-syntax -- a live status dot pulses while connecting; it is not a placeholder
          offline ? 'bg-status-danger' : 'bg-status-warning animate-pulse motion-reduce:animate-none',
        )}
      />
      {t(`settings.client.state.${state}`)}
    </span>
  )
}
