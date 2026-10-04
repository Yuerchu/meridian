import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * What the conversation is doing, on a tab hanging from the composer's top
 * edge: the branch and the checklist's progress on the left, how full the
 * context window is on the right.
 *
 * The split follows Telegram's input panel: what will be sent with the message
 * (attachments) is inside the card, and the state of things around it is
 * outside. The geometry is BoardUI Pro composer-panel's status tab — inset
 * 28px each side so it reads as part of the card's edge rather than a bar
 * above it, rounded at the top only, on the registry's tab fill.
 *
 * Nothing to say is no tab at all: the welcome screen, and a conversation
 * that has neither a checklist nor a reading. `pending` keeps it while a
 * reading is on its way: the tab is 34px, and appearing a moment after a
 * conversation opens would push the whole transcript up under the reader.
 */
export function ComposerStatusTab({
  branch,
  progress,
  usage,
  pending,
}: {
  /** The project's branch. Nothing provides it yet. */
  branch?: ReactNode
  progress?: ReactNode
  usage?: ReactNode
  /** Something is about to be shown: hold the space for it. */
  pending?: boolean
}) {
  const { t } = useTranslation()
  if (!branch && !progress && !usage && !pending) return null
  return (
    <div
      role="group"
      aria-label={t('composer.status')}
      data-slot="composer-status-tab"
      className="mx-7 flex h-[34px] min-w-0 items-center justify-between gap-3 rounded-t-2xl bg-composer-panel-tab-background px-2 py-1"
    >
      <div data-slot="composer-status-start" className="flex min-w-0 items-center gap-3">
        {branch}
        {progress}
      </div>
      <div data-slot="composer-status-end" className="flex shrink-0 items-center">
        {usage}
      </div>
    </div>
  )
}
