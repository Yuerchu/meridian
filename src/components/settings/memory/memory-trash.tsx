import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrashBin, ArrowUturnCcwLeft } from '@gravity-ui/icons'
import { api } from '@/api'
import { Button, Card, Drawer } from '@heroui/react'
import { MemoryBadge } from './memory-badge'
import type { Memory } from '@/types'
import { useHistoryLevel } from '@/hooks/use-nav'

interface MemoryTrashProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

/**
 * Soft-deleted rows, including the ones eviction removed — that is the only
 * place an operator can see which people the bot has forgotten.
 */
export function MemoryTrash({ open, onOpenChange, onChanged }: MemoryTrashProps) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Memory[]>([])
  // `Drawer.Heading` is wired up for us, the hint under it is not — without this
  // the drawer announces its title and nothing else.
  const hintId = useId()

  const load = useCallback(() => {
    api.listMemoryTrash(200).then(setRows).catch(() => setRows([]))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  // Without this the back gesture would close the settings screen out from
  // under an open drawer instead of closing the drawer.
  useHistoryLevel(open, () => onOpenChange(false))

  const deletedByLabel = (by: string | null) => {
    switch (by) {
      case 'self':
        return t('settings.memory.trash.deletedBy.self')
      case 'lru':
        return t('settings.memory.trash.deletedBy.lru')
      default:
        return t('settings.memory.trash.deletedBy.admin')
    }
  }

  return (
    <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog
          aria-describedby={hintId}
          // Portalled, so no ancestor's inset reaches it: the restore and purge
          // buttons on the last row would sit under the navigation bar.
          className="w-[28rem] max-w-[85vw] pb-[max(1.5rem,var(--safe-bottom))] pr-[max(1.5rem,var(--safe-right))]"
          data-slot="memory-trash"
        >
          <Drawer.CloseTrigger />
          <Drawer.Header className="gap-1">
            <Drawer.Heading>{t('settings.memory.trash.title')}</Drawer.Heading>
            <p id={hintId} className="text-sm text-muted">
              {t('settings.memory.trash.retentionHint')}
            </p>
          </Drawer.Header>

          <Drawer.Body className="space-y-2">
            {rows.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">
                {t('settings.memory.trash.empty')}
              </p>
            )}
            {/* Secondary, not the default surface: the drawer itself is
                `--overlay`, which is the same colour as `--surface`, so only the
                sunken step reads as a row against it. */}
            {rows.map((m) => (
              <Card key={m.id} data-slot="memory-trash-row" variant="secondary">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{m.key}</span>
                  <MemoryBadge tone="info">{deletedByLabel(m.deleted_by)}</MemoryBadge>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    isIconOnly
                    onClick={async () => {
                      await api.restoreMemories([m.id])
                      load()
                      onChanged()
                    }}
                    data-slot="memory-trash-restore"
                  >
                    <ArrowUturnCcwLeft />
                  </Button>
                  <Button
                    variant="ghost"
                    isIconOnly
                    onClick={async () => {
                      await api.purgeMemories([m.id])
                      load()
                      onChanged()
                    }}
                    data-slot="memory-trash-purge"
                  >
                    <TrashBin className="text-danger" />
                  </Button>
                </div>
                <Card.Description className="whitespace-pre-wrap">{m.content}</Card.Description>
              </Card>
            ))}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}
