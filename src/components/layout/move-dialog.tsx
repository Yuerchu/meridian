import { useTranslation } from 'react-i18next'
import './move-dialog.css'
import { ListBox, ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Dialog, DialogFooter } from '@/components/yuerchu-ui/components/dialog/dialog'
import { Button } from '@/components/yuerchu-ui/components/button/button'
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

  // A list of places, so a list: the library's `ListBox`, not a column of
  // buttons. The current location is the disabled row's description rather than
  // a trailing label, so a screen reader hears where the conversation is filed.
  const NONE = '__none__'
  const destination = (id: string | null, icon: React.ReactNode, label: string) => (
    <ListBoxItem
      key={id ?? NONE}
      id={id ?? NONE}
      icon={icon}
      description={id === currentProjectId ? t('moveDialog.currentLocation') : null}
    >
      {label}
    </ListBoxItem>
  )
  const allKeys = [NONE, ...projects.map((project) => project.id)]

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      heading={t('moveDialog.title')}
      size="sm"
      className="m-move-dialog"
    >
      <div className="m-move-dialog__body">
        {error && (
          <Alert data-slot="move-dialog-error" tone="danger" shouldAnnounce>
            {error}
          </Alert>
        )}
        <ListBox
          data-slot="move-dialog-destinations"
          aria-label={t('moveDialog.title')}
          disabledKeys={isPending ? allKeys : [currentProjectId ?? NONE]}
          onAction={(key) => void choose(key === NONE ? null : String(key))}
        >
          {destination(null, <Message />, t('moveDialog.noProject'))}
          {projects.map((project) =>
            destination(project.id, <ProjectIcon sourceType={project.source_type} />, project.name),
          )}
        </ListBox>
      </div>
      <DialogFooter>
        <Button slot="close" variant="secondary" isDisabled={isPending}>
          {t('common.cancel')}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
