import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrashBin, ArrowUturnCcwLeft } from '@gravity-ui/icons'
import { api } from '@/api'
import { Button, Card, Chip, Drawer, Spinner } from '@heroui/react'
import { EmptyState } from '@heroui-pro/react/empty-state'
import { INFO_CHIP } from './memory-row'
import type { Memory } from '@/types'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useConfirm } from '@/hooks/use-confirm'

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  // `Drawer.Heading` is wired up for us, the hint under it is not — without this
  // the drawer announces its title and nothing else.
  const hintId = useId()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await api.listMemoryTrash(200))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setLoading(false)
    }
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
    <>
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
              {loading ? (
                <div role="status" aria-label={t('common.loading')} className="flex justify-center p-6">
                  <Spinner aria-hidden="true" />
                </div>
              ) : error ? (
                <div
                  role="alert"
                  className="space-y-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
                >
                  <p>{t('settings.memory.trash.loadError')}</p>
                  <Button size="sm" variant="outline" onPress={() => void load()}>
                    {t('settings.memory.retry')}
                  </Button>
                </div>
              ) : rows.length === 0 ? (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>{t('settings.memory.trash.empty')}</EmptyState.Title>
                  </EmptyState.Header>
                </EmptyState>
              ) : null}
              {/* Secondary, not the default surface: the drawer itself is
                `--overlay`, which is the same colour as `--surface`, so only the
                sunken step reads as a row against it. */}
              {rows.map((m) => (
                <Card key={m.id} data-slot="memory-trash-row" variant="secondary">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 break-words font-mono text-sm [overflow-wrap:anywhere]">
                      {m.key}
                    </span>
                    <Chip className={INFO_CHIP}>{deletedByLabel(m.deleted_by)}</Chip>
                    <div className="ms-auto flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        isIconOnly
                        aria-label={t('settings.memory.trash.restore')}
                        onPress={async () => {
                          await api.restoreMemories([m.id])
                          void load()
                          onChanged()
                        }}
                        data-slot="memory-trash-restore"
                      >
                        <ArrowUturnCcwLeft />
                      </Button>
                      <Button
                        variant="ghost"
                        isIconOnly
                        aria-label={t('settings.memory.trash.purge')}
                        onPress={async () => {
                          const accepted = await confirm({
                            body: t('settings.memory.trash.purgeConfirm', { key: m.key }),
                          })
                          if (!accepted) return
                          await api.purgeMemories([m.id])
                          void load()
                          onChanged()
                        }}
                        data-slot="memory-trash-purge"
                      >
                        <TrashBin className="text-danger" />
                      </Button>
                    </div>
                  </div>
                  <Card.Description className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {m.content}
                  </Card.Description>
                </Card>
              ))}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
      {confirmDialog}
    </>
  )
}
