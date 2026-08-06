import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, Undo2 } from 'lucide-react'
import { api } from '@/api'
import { Button, Drawer } from '@heroui/react'
import { MemoryBadge } from './memory-badge'
import type { Memory } from '@/types'

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
          className="w-[28rem] max-w-[85vw]"
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
            {rows.map((m) => (
              <div
                key={m.id}
                data-slot="memory-trash-row"
                className="space-y-1.5 rounded-lg border border-border p-3"
              >
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
                    <Undo2 />
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
                    <Trash2 className="text-danger" />
                  </Button>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted">{m.content}</p>
              </div>
            ))}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}
