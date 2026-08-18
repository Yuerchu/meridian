import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, TrashBin, ArrowUpFromLine, Sticker } from '@gravity-ui/icons'
import { Button, Chip, Disclosure, Input } from '@heroui/react'
import { EmptyState } from '@heroui-pro/react/empty-state'
import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { useConfirm } from '@/hooks/use-confirm'
import { SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import type { Emoji, EmojiPack } from '@/types'

interface PackDetail {
  pack: EmojiPack
  emojis: Emoji[]
  urls: Record<string, string>
}

function PackCard({
  detail,
  onDelete,
  onImport,
  onDeleteEmoji,
  onRenameEmoji,
}: {
  detail: PackDetail
  onDelete?: () => void
  onImport: () => void
  onDeleteEmoji: (id: string) => void
  onRenameEmoji: (id: string, newName: string) => void
}) {
  const { t } = useTranslation()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  return (
    // Render prop rather than a controlled `isExpanded`: the open state is only
    // read one level down, so the card keeps its own uncontrolled state and no
    // caller has to hold it.
    <Disclosure className="flex w-full flex-col overflow-hidden rounded-lg border border-border">
      {({ isExpanded }) => (
        <>
          <Disclosure.Heading>
            {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto`
                and `shrink-0`, which only mean anything inside a flex container.
                `text-start` undoes the button element's centred UA default. */}
            <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30">
              <Sticker className="w-3.5 h-3.5 shrink-0 text-muted" />
              <span className="flex-1 truncate">{detail.pack.name}</span>
              <span className="text-xs text-muted">{detail.emojis.length}</span>
              {detail.pack.is_builtin === 1 && (
                <Chip className="shrink-0 text-muted">{t('settings.template.builtin')}</Chip>
              )}
              <Disclosure.Indicator className="size-4 shrink-0 text-muted" />
            </Disclosure.Trigger>
          </Disclosure.Heading>

          {/* `min-h-0` is load-bearing: the card is a flex column, and a flex item's
              default `min-height: auto` floors it at its content height. */}
          <Disclosure.Content className="min-h-0 w-full">
            {/* Body, not a plain wrapper: it is what keeps the panel measurable, so
                without it the grid never collapses. */}
            <Disclosure.Body className="space-y-3">
              {/* A collapsed panel is only hidden, not unmounted, so the grid
                  has to be gated: every pack's images — GIF and APNG among them
                  — would otherwise be decoded and held as bitmaps on every
                  visit to this page, open or not. The cost is that collapsing
                  drops the content in the same frame as the height animation. */}
              {isExpanded && (
                <>
                  {detail.pack.description && <p className="text-xs text-muted">{detail.pack.description}</p>}

                  {/* Six across needs 280px of grid before gaps; a 360px phone
                      does not have it once the card's own padding is taken. */}
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {detail.emojis.map((e) => (
                      <div key={e.id} className="group relative">
                        <img src={detail.urls[e.id]} alt={e.name} className="w-10 h-10 object-contain rounded" />
                        {editingId === e.id ? (
                          <Input
                            fullWidth
                            autoFocus
                            value={editName}
                            onChange={(ev) => setEditName(ev.target.value)}
                            onBlur={() => {
                              if (editName.trim() && editName.trim() !== e.name) onRenameEmoji(e.id, editName.trim())
                              setEditingId(null)
                            }}
                            onKeyDown={(ev) => {
                              if (ev.nativeEvent.isComposing) return
                              if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
                              if (ev.key === 'Escape') setEditingId(null)
                            }}
                            className="w-full h-auto text-xs text-center bg-transparent border-0 border-b border-default rounded-none px-0 py-0 mt-0.5 focus-visible:ring-0"
                          />
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full h-auto min-w-0 rounded-lg px-0 py-0 mt-0.5 text-xs font-normal text-muted hover:text-foreground"
                            onClick={() => {
                              setEditingId(e.id)
                              setEditName(e.name)
                            }}
                            aria-label={`${t('settings.emoji.clickToRename')}: ${e.name}`}
                          >
                            <span className="truncate">{e.name}</span>
                          </Button>
                        )}
                        {detail.pack.is_builtin === 0 && (
                          <Button
                            variant="ghost"
                            isIconOnly
                            aria-label={t('settings.emoji.deleteEmoji')}
                            // Always visible where there is no hover to reveal
                            // it — this is the only way to delete an emoji, and
                            // a touch screen never reaches `group-hover`.
                            className="absolute -top-1.5 -right-1.5 !size-6 rounded-full bg-danger text-danger-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 touch-hitbox"
                            onClick={() => onDeleteEmoji(e.id)}
                          >
                            <TrashBin className="!size-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* The picker returns paths on this device and the import
                        is read by whichever machine the backend is on. */}
                    <Button variant="outline" onClick={onImport} isDisabled={!can.importFromDisk}>
                      <ArrowUpFromLine className="w-3.5 h-3.5" />
                      {t('settings.emoji.import')}
                    </Button>
                    {onDelete && detail.pack.is_builtin === 0 && (
                      <Button variant="ghost" className="ml-auto text-danger hover:text-danger" onClick={onDelete}>
                        <TrashBin className="w-3.5 h-3.5" />
                        {t('common.delete')}
                      </Button>
                    )}
                  </div>
                  {!can.importFromDisk && <p className="text-xs text-muted">{t('capability.importFromDisk')}</p>}
                </>
              )}
            </Disclosure.Body>
          </Disclosure.Content>
        </>
      )}
    </Disclosure>
  )
}

export function EmojiSettings() {
  const { t } = useTranslation()
  const [details, setDetails] = useState<PackDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [newPackName, setNewPackName] = useState('')
  const { confirm, confirmDialog } = useConfirm()

  const refresh = useCallback(async () => {
    const packs = await api.listEmojiPacks()
    const result: PackDetail[] = []
    for (const pack of packs) {
      const emojis = await api.listEmojis(pack.id)
      const urls: Record<string, string> = {}
      for (const e of emojis) {
        const path = await api.getEmojiFileUrl(e.id)
        urls[e.id] = path
      }
      result.push({ pack, emojis, urls })
    }
    setDetails(result)
  }, [])

  useEffect(() => {
    refresh().then(() => setLoading(false))
  }, [refresh])

  const handleCreate = useCallback(async () => {
    if (!newPackName.trim()) return
    await api.createEmojiPack(newPackName.trim())
    setNewPackName('')
    await refresh()
  }, [newPackName, refresh])

  const handleDelete = useCallback(
    async (id: string) => {
      if (!(await confirm({ body: t('settings.confirmDelete.emojiPack') }))) return
      await api.deleteEmojiPack(id)
      await refresh()
    },
    [confirm, t, refresh],
  )

  const handleImport = useCallback(
    async (packId: string) => {
      // Cancelling the picker rejects on Android instead of resolving to null.
      const files = await dialogOpen({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['gif', 'apng', 'png', 'webp', 'jpg', 'jpeg', 'bmp', 'json'] }],
      }).catch(() => null)
      if (!files) return
      const paths = Array.isArray(files) ? files : [files]
      if (paths.length === 0) return
      await api.importEmojis(packId, paths)
      await refresh()
    },
    [refresh],
  )

  const handleDeleteEmoji = useCallback(
    async (id: string) => {
      if (!(await confirm({ body: t('settings.confirmDelete.emoji') }))) return
      await api.deleteEmoji(id)
      await refresh()
    },
    [confirm, t, refresh],
  )

  const handleRenameEmoji = useCallback(
    async (id: string, newName: string) => {
      await api.renameEmoji(id, newName)
      await refresh()
    },
    [refresh],
  )

  if (loading) {
    return <SettingsSkeleton />
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.emoji.title')} subtitle={t('settings.emoji.subtitle')} />

      <div className="flex gap-2">
        <Input
          fullWidth
          value={newPackName}
          onChange={(e) => setNewPackName(e.target.value)}
          placeholder={t('settings.emoji.packName')}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') handleCreate()
          }}
        />
        <Button variant="outline" onClick={handleCreate} isDisabled={!newPackName.trim()}>
          <Plus className="w-3.5 h-3.5" />
          {t('settings.emoji.newPack')}
        </Button>
      </div>

      <div className="space-y-1">
        {details.map((d) => (
          <PackCard
            key={d.pack.id}
            detail={d}
            onDelete={() => handleDelete(d.pack.id)}
            onImport={() => handleImport(d.pack.id)}
            onDeleteEmoji={handleDeleteEmoji}
            onRenameEmoji={handleRenameEmoji}
          />
        ))}
        {details.length === 0 && (
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Title>{t('settings.emoji.noPacks')}</EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        )}
      </div>
      {confirmDialog}
    </SettingsPane>
  )
}
