import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Upload, ChevronDown, ChevronRight, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api'
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
  const [expanded, setExpanded] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <Package className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="flex-1 truncate">{detail.pack.name}</span>
        <span className="text-[11px] text-muted-foreground">{detail.emojis.length}</span>
        {detail.pack.is_builtin === 1 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">
            {t('settings.template.builtin')}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {detail.pack.description && (
            <p className="text-xs text-muted-foreground">{detail.pack.description}</p>
          )}

          <div className="grid grid-cols-6 gap-2">
            {detail.emojis.map((e) => (
              <div key={e.id} className="group relative">
                <img
                  src={detail.urls[e.id]}
                  alt={e.name}
                  className="w-10 h-10 object-contain rounded"
                />
                {editingId === e.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(ev) => setEditName(ev.target.value)}
                    onBlur={() => {
                      if (editName.trim() && editName.trim() !== e.name) onRenameEmoji(e.id, editName.trim())
                      setEditingId(null)
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
                      if (ev.key === 'Escape') setEditingId(null)
                    }}
                    className="w-full text-[9px] text-center bg-transparent border-b border-accent outline-none mt-0.5"
                  />
                ) : (
                  <p
                    className="text-[9px] text-muted-foreground text-center truncate mt-0.5 cursor-pointer hover:text-foreground"
                    onClick={() => { setEditingId(e.id); setEditName(e.name) }}
                    title={t('settings.emoji.clickToRename')}
                  >
                    {e.name}
                  </p>
                )}
                {detail.pack.is_builtin === 0 && (
                  <button
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    onClick={() => onDeleteEmoji(e.id)}
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onImport}>
              <Upload className="w-3.5 h-3.5" />
              {t('settings.emoji.import')}
            </Button>
            {onDelete && detail.pack.is_builtin === 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('common.delete')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function EmojiSettings() {
  const { t } = useTranslation()
  const [details, setDetails] = useState<PackDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [newPackName, setNewPackName] = useState('')

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

  const handleDelete = useCallback(async (id: string) => {
    await api.deleteEmojiPack(id)
    await refresh()
  }, [refresh])

  const handleImport = useCallback(async (packId: string) => {
    const files = await dialogOpen({
      multiple: true,
      filters: [{ name: 'Images', extensions: ['gif', 'apng', 'png', 'webp', 'jpg', 'jpeg', 'bmp', 'json'] }],
    })
    if (!files) return
    const paths = Array.isArray(files) ? files : [files]
    if (paths.length === 0) return
    await api.importEmojis(packId, paths)
    await refresh()
  }, [refresh])

  const handleDeleteEmoji = useCallback(async (id: string) => {
    await api.deleteEmoji(id)
    await refresh()
  }, [refresh])

  const handleRenameEmoji = useCallback(async (id: string, newName: string) => {
    await api.renameEmoji(id, newName)
    await refresh()
  }, [refresh])

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('common.loading')}</div>
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.emoji.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('settings.emoji.subtitle')}</p>
      </div>

      <div className="flex gap-2">
        <Input
          value={newPackName}
          onChange={(e) => setNewPackName(e.target.value)}
          placeholder={t('settings.emoji.packName')}
          className="flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
        />
        <Button variant="outline" size="sm" onClick={handleCreate} disabled={!newPackName.trim()}>
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
          <p className="text-sm text-muted-foreground text-center py-6">
            {t('settings.emoji.noPacks')}
          </p>
        )}
      </div>
    </div>
  )
}
