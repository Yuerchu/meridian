import { useTranslation } from 'react-i18next'
import { Button, Modal } from '@heroui/react'
import { Comment } from '@gravity-ui/icons'

import type { Project } from '@/types'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { ProjectIcon } from './project-icon'

/**
 * Where a conversation should live: a project, or none.
 *
 * A dialog rather than a submenu, because the row's actions are reached two
 * ways — a cursor-anchored right-click menu and a button-anchored touch menu —
 * and a submenu would have to exist twice, once per menu implementation. Both
 * paths land here instead, and it is the same surface a phone can use.
 */
export function MoveDialog({
  isOpen,
  onOpenChange,
  projects,
  currentProjectId,
  error,
  isPending,
  onMove,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  /** Where the conversation is now; that row is disabled rather than hidden,
      so the list also answers "where is this filed". */
  currentProjectId: string | null
  error: string | null
  isPending: boolean
  /** `true` closes the dialog; `false` leaves the error visible here. */
  onMove: (projectId: string | null) => Promise<boolean>
}) {
  const { t } = useTranslation()

  // A level of its own, like the rename dialog: the back gesture closes the
  // dialog, not whatever is behind it.
  useHistoryLevel(isOpen, () => onOpenChange(false))

  const choose = async (projectId: string | null) => {
    if (await onMove(projectId)) onOpenChange(false)
  }

  const destination = (id: string | null, icon: React.ReactNode, label: string) => (
    <Button
      key={id ?? 'none'}
      variant="ghost"
      onClick={() => void choose(id)}
      isDisabled={isPending || id === currentProjectId}
      className="w-full justify-start"
    >
      {icon}
      <span className="truncate">{label}</span>
      {id === currentProjectId && (
        <span className="ml-auto shrink-0 text-xs text-muted">{t('moveDialog.currentLocation')}</span>
      )}
    </Button>
  )

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="center" className="pb-[var(--ime-bottom,0px)]">
        <Modal.Dialog data-slot="move-dialog" className="sm:max-w-[360px]">
          <Modal.Header>
            <Modal.Heading>{t('moveDialog.title')}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-1">
            {error && (
              <p role="alert" className="mb-1 text-xs text-danger">
                {error}
              </p>
            )}
            {destination(null, <Comment className="text-muted" />, t('moveDialog.noProject'))}
            {projects.map((project) =>
              destination(project.id, <ProjectIcon sourceType={project.source_type} />, project.name),
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary" isDisabled={isPending}>
              {t('common.cancel')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
