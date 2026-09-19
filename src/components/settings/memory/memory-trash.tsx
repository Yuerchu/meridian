import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrashBin, ArrowUturnCcwLeft } from '@gravity-ui/icons'
import { api } from '@/api'
import { Alert, Button, Card, Chip, Sheet, Spinner, Tooltip, TooltipTrigger } from '@/components/base'
import { EmptyState } from '@/components/base'
import { INFO_CHIP } from './memory-row'
import type { MemoryInfoResponse } from '@/types'
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
  const [rows, setRows] = useState<MemoryInfoResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  // `Sheet.Heading` is wired up for us, the hint under it is not — without this
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
      <Sheet isOpen={open} onOpenChange={onOpenChange} placement="right">
        <Sheet.Backdrop>
          <Sheet.Content>
            <Sheet.Dialog
              aria-describedby={hintId}
              // Portalled, so no ancestor's inset reaches it: the restore and purge
              // buttons on the last row would sit under the navigation bar.
              className="w-[28rem] max-w-[85vw] pb-[max(1.5rem,var(--safe-bottom))] pr-[max(1.5rem,var(--safe-right))]"
              data-slot="memory-trash"
            >
              <Sheet.CloseTrigger />
              <Sheet.Header className="gap-1">
                <Sheet.Heading>{t('settings.memory.trash.title')}</Sheet.Heading>
                <p id={hintId} data-slot="memory-trash-hint" className="text-body-regular text-text-secondary">
                  {t('settings.memory.trash.retentionHint')}
                </p>
              </Sheet.Header>

              <Sheet.Body className="space-y-2">
                {loading ? (
                  <div
                    data-slot="memory-trash-loading"
                    role="status"
                    aria-label={t('common.loading')}
                    className="flex justify-center p-6"
                  >
                    <Spinner aria-hidden="true" />
                  </div>
                ) : error ? (
                  <Alert status="danger" role="alert">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>{t('settings.memory.trash.loadError')}</Alert.Description>
                      <Button size="small" variant="outline" className="mt-2" onPress={() => void load()}>
                        {t('settings.memory.retry')}
                      </Button>
                    </Alert.Content>
                  </Alert>
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
                    <div data-slot="memory-trash-row-header" className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        data-slot="memory-trash-row-key"
                        className="min-w-0 flex-1 break-words font-mono text-body-regular [overflow-wrap:anywhere]"
                      >
                        {m.key}
                      </span>
                      <Chip className={INFO_CHIP}>{deletedByLabel(m.deleted_by)}</Chip>
                      <div data-slot="memory-trash-row-actions" className="ms-auto flex shrink-0 items-center gap-1">
                        <TooltipTrigger delay={0}>
                          <Button
                            variant="ghost"
                            iconOnly
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
                          <Tooltip>{t('settings.memory.trash.restore')}</Tooltip>
                        </TooltipTrigger>
                        <TooltipTrigger delay={0}>
                          <Button
                            variant="ghost"
                            iconOnly
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
                            <TrashBin className="text-status-danger" />
                          </Button>
                          <Tooltip>{t('settings.memory.trash.purge')}</Tooltip>
                        </TooltipTrigger>
                      </div>
                    </div>
                    <Card.Description className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {m.content}
                    </Card.Description>
                  </Card>
                ))}
              </Sheet.Body>
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
      {confirmDialog}
    </>
  )
}
