import './memory-trash.css'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUTurnLeft, Bin } from '@keyline-icons/react/two-tone'
import { api } from '@/api'
import { Drawer } from '@/components/yuerchu-ui/components/drawer/drawer'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import type { MemoryInfoResponse } from '@/types'
import { useConfirm } from '@/hooks/use-confirm'
import { useHistoryLevel } from '@/hooks/use-history-level'

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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await api.memories.list({ filter: { kind: 'trash', limit: 200 } }))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  // The back gesture closes the drawer: the library's Drawer does not know about it.
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
      <Drawer
        isOpen={open}
        onOpenChange={onOpenChange}
        heading={t('settings.memory.trash.title')}
        description={t('settings.memory.trash.retentionHint')}
        // Portalled, so no ancestor's inset reaches it: the restore and purge
        // buttons on the last row would sit under the navigation bar.
        className="m-memory-trash"
        data-slot="memory-trash"
      >
        <div className="m-memory-trash__body">
          {loading ? (
            <div
              data-slot="memory-trash-loading"
              role="status"
              aria-label={t('common.loading')}
              className="m-memory-trash__loading"
            >
              <span aria-hidden>
                <Spinner />
              </span>
            </div>
          ) : error ? (
            <Alert
              tone="danger"
              shouldAnnounce
              actions={
                <Button size="sm" variant="secondary" onPress={() => void load()}>
                  {t('settings.memory.retry')}
                </Button>
              }
            >
              {t('settings.memory.trash.loadError')}
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState heading={t('settings.memory.trash.empty')} headingLevel={3} size="sm" />
          ) : null}
          {/* Secondary, not the default surface: the drawer itself is
                `--overlay`, which is the same colour as `--surface`, so only the
                sunken step reads as a row against it. */}
          {rows.map((m) => (
            <section key={m.id} data-slot="memory-trash-row" className="m-memory-trash__row">
              <div data-slot="memory-trash-row-header" className="m-memory-trash__row-header">
                <span data-slot="memory-trash-row-key" className="m-memory-trash__row-key">
                  {m.key}
                </span>
                <Badge>{deletedByLabel(m.deleted_by)}</Badge>
                <div data-slot="memory-trash-row-actions" className="m-memory-trash__row-actions">
                  <TooltipTrigger>
                    <Button
                      variant="ghost"
                      icon={<ArrowUTurnLeft />}
                      size="sm"
                      aria-label={t('settings.memory.trash.restore')}
                      onPress={async () => {
                        await api.memories.restore({ ids: [m.id] })
                        void load()
                        onChanged()
                      }}
                      data-slot="memory-trash-restore"
                    />
                    <Tooltip>{t('settings.memory.trash.restore')}</Tooltip>
                  </TooltipTrigger>
                  <TooltipTrigger>
                    <Button
                      variant="ghost"
                      icon={<Bin />}
                      size="sm"
                      aria-label={t('settings.memory.trash.purge')}
                      onPress={async () => {
                        const accepted = await confirm({
                          description: t('settings.memory.trash.purgeConfirm', { key: m.key }),
                          confirmLabel: t('settings.memory.trash.purge'),
                          tone: 'danger',
                        })
                        if (!accepted) return
                        await api.memories.delete({ ids: [m.id], permanent: true })
                        void load()
                        onChanged()
                      }}
                      data-slot="memory-trash-purge"
                    />
                    <Tooltip>{t('settings.memory.trash.purge')}</Tooltip>
                  </TooltipTrigger>
                </div>
              </div>
              <p className="m-memory-trash__content">{m.content}</p>
            </section>
          ))}
        </div>
      </Drawer>
      {confirmDialog}
    </>
  )
}
