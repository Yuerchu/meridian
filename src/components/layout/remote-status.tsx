import './remote-status.css'
import { useTranslation } from 'react-i18next'

import { useConnectionState } from '@/hooks/use-connection-state'
import { isRemote } from '@/lib/transport'

/**
 * Whether the machine answering this window is still there.
 *
 * Nothing at all while it is — a badge that says "connected" for hours is a
 * badge nobody reads by the time it matters, and the states that need saying
 * are the two that change what the app will let you do. Offline is drawn in
 * `--danger-fg` rather than `--warning-fg` because it is not a degradation: the
 * composer is disabled underneath it and no turn can be started.
 *
 * `role="status"` so the change is announced once, without moving focus.
 */
export function RemoteStatus() {
  const { t } = useTranslation()
  const state = useConnectionState()

  if (!isRemote || state === 'connected') return null

  return (
    <span data-slot="remote-status" role="status" data-state={state} className="m-remote-status">
      {/* The word beside it says the same thing, so announcing the dot too
          would only say it twice. */}
      <span data-slot="remote-status-dot" aria-hidden className="m-remote-status__dot" />
      {t(`settings.client.state.${state}`)}
    </span>
  )
}
