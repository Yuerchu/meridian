import { useTranslation } from 'react-i18next'
import { Button, ListBox, Modal } from '@/components/base'
import { Message } from '@keyline-icons/react/two-tone'

import type { ProjectInfoResponse } from '@/types'
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
  projects: ProjectInfoResponse[]
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

  // A list of places, so a list: the registry's menu row (`ListBox.Item`)
  // rather than a column of `w-full justify-start` Buttons, which on BoardUI's
  // accent-soft `ghost` drew every destination as a selected blue pill.
  const NONE = '__none__'
  const destination = (id: string | null, icon: React.ReactNode, label: string) => (
    <ListBox.Item key={id ?? NONE} id={id ?? NONE} textValue={label} className="gap-2 rounded-2lg p-2">
      {icon}
      <span data-slot="move-dialog-destination-label" className="truncate">
        {label}
      </span>
      {id === currentProjectId && (
        <span
          data-slot="move-dialog-current-location"
          className="ml-auto shrink-0 text-caption-1-regular text-text-secondary"
        >
          {t('moveDialog.currentLocation')}
        </span>
      )}
    </ListBox.Item>
  )
  const allKeys = [NONE, ...projects.map((project) => project.id)]

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="center" size="sm" className="pb-[var(--ime-bottom,0px)]">
        <Modal.Dialog data-slot="move-dialog">
          <Modal.Header>
            <Modal.Heading>{t('moveDialog.title')}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-1">
            {error && (
              <p data-slot="move-dialog-error" role="alert" className="mb-1 text-caption-1-regular text-status-danger">
                {error}
              </p>
            )}
            <ListBox
              data-slot="move-dialog-destinations"
              aria-label={t('moveDialog.title')}
              className="gap-1"
              disabledKeys={isPending ? allKeys : [currentProjectId ?? NONE]}
              onAction={(key) => void choose(key === NONE ? null : String(key))}
            >
              {destination(null, <Message className="size-4 text-text-secondary" />, t('moveDialog.noProject'))}
              {projects.map((project) =>
                destination(project.id, <ProjectIcon sourceType={project.source_type} />, project.name),
              )}
            </ListBox>
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
