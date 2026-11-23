import './composer-status-tab.css'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from '@keyline-icons/react/two-tone'

import type { ProjectBranch } from '@/hooks/use-project-branch'

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
  tasks,
  usage,
  pending,
}: {
  /** The project's branch (`ProjectBranchChip`). */
  branch?: ReactNode
  progress?: ReactNode
  /** Commands left running in the background (`BackgroundTasksChip`). */
  tasks?: ReactNode
  usage?: ReactNode
  /** Something is about to be shown: hold the space for it. */
  pending?: boolean
}) {
  const { t } = useTranslation()
  if (!branch && !progress && !tasks && !usage && !pending) return null
  return (
    <div
      role="group"
      aria-label={t('composer.status')}
      data-slot="composer-status-tab"
      className="m-composer-status-tab"
    >
      <div data-slot="composer-status-start" className="m-composer-status-tab__start">
        {branch}
        {progress}
        {tasks}
      </div>
      <div data-slot="composer-status-end" className="m-composer-status-tab__end">
        {usage}
      </div>
    </div>
  )
}

/**
 * The project's branch, at the start of the status tab: where the agent's
 * edits and commits will land, seen before anything is sent. Read-only — it
 * says which branch, it does not switch one.
 *
 * The name is the mono face because it is an identifier, not prose, and is
 * cut at the chip's width. A screen reader hears "Branch" before it, which the
 * icon says to everyone else.
 */
export function ProjectBranchChip({ branch }: { branch: ProjectBranch }) {
  const { t } = useTranslation()
  if (branch.status !== 'branch' && branch.status !== 'detached') return null
  const name = branch.status === 'branch' ? branch.name : t('composer.branchDetached')
  return (
    <span data-slot="project-branch-chip" className="m-composer-status-tab__branch">
      <GitBranch className="m-composer-status-tab__branch-icon" aria-hidden />
      <span className="m-composer-status-tab__sr">{t('composer.branch')}</span>
      <span
        data-slot="project-branch-chip-name"
        data-mono={branch.status === 'branch' || undefined}
        className="m-composer-status-tab__branch-name"
      >
        {name}
      </span>
    </span>
  )
}
