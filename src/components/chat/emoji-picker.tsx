import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FaceSmile, Magnifier } from '@gravity-ui/icons'
import { Button, Input, Popover, Tooltip } from '@heroui/react'
import { api } from '@/api'
import type { Emoji, EmojiPack } from '@/types'

interface PackWithEmojis {
  pack: EmojiPack
  emojis: Emoji[]
}

export function EmojiPicker({
  assistantId,
  onSelect,
}: {
  assistantId: string | null
  onSelect: (syntax: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [packs, setPacks] = useState<PackWithEmojis[]>([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Emoji[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open || !assistantId) return
    let cancelled = false

    async function load() {
      const assignedPacks = await api.listAssistantEmojiPacks(assistantId!)
      const result: PackWithEmojis[] = []
      const urlMap: Record<string, string> = {}

      for (const pack of assignedPacks) {
        const emojis = await api.listEmojis(pack.id)
        result.push({ pack, emojis })
        for (const e of emojis) {
          const path = await api.getEmojiFileUrl(e.id)
          urlMap[e.id] = path
        }
      }

      if (!cancelled) {
        setPacks(result)
        setUrls(urlMap)
      }
    }

    load()
    return () => { cancelled = true }
  }, [open, assistantId])

  const handleSearch = useCallback(async (q: string) => {
    setSearch(q)
    if (q.trim().length < 1) { setSearchResults([]); return }
    const results = await api.searchEmojis(q.trim())
    setSearchResults(results)
    const urlMap = { ...urls }
    for (const e of results) {
      if (!urlMap[e.id]) {
        const path = await api.getEmojiFileUrl(e.id)
        urlMap[e.id] = path
      }
    }
    setUrls(urlMap)
  }, [urls])

  const handleSelect = useCallback((emoji: Emoji) => {
    onSelect(`[emoji:${emoji.name}]`)
    setOpen(false)
  }, [onSelect])

  if (!assistantId) return null

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Tooltip delay={0}>
        <Button isIconOnly aria-label={t('chat.emoji')} variant="ghost">
          <FaceSmile className="w-4 h-4" />
        </Button>
        <Tooltip.Content placement="top">{t('chat.emoji')}</Tooltip.Content>
      </Tooltip>
      <Popover.Content placement="top end" className="w-72 overflow-hidden p-0">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Magnifier className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
            <Input fullWidth
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t('chat.emojiSearch')}
              className="pl-7 text-xs"
            />
          </div>
        </div>

        <div data-slot="emoji-picker-list" className="max-h-56 overflow-y-auto overscroll-contain"><div className="p-2">
          {search.trim() ? (
            <div className="grid grid-cols-6 gap-1">
              {searchResults.map((e) => (
                <Button
                  key={e.id}
                  variant="ghost"
                  className="h-auto p-1 rounded hover:bg-default/50 transition-colors"
                  onClick={() => handleSelect(e)}
                >
                  <img
                    src={urls[e.id]}
                    alt={e.name}
                    className="w-7 h-7 object-contain"
                    title={e.name}
                  />
                </Button>
              ))}
              {searchResults.length === 0 && (
                <p className="col-span-6 text-xs text-muted text-center py-3">
                  {t('chat.emojiNotFound')}
                </p>
              )}
            </div>
          ) : (
            packs.map(({ pack, emojis }) => (
              <div key={pack.id} className="mb-2">
                <p className="text-xs text-muted font-medium mb-1 px-1">
                  {pack.name}
                </p>
                <div className="grid grid-cols-6 gap-1">
                  {emojis.map((e) => (
                    <Button
                      key={e.id}
                      variant="ghost"
                      className="h-auto rounded p-1 transition-colors hover:bg-default/50"
                      onClick={() => handleSelect(e)}
                    >
                      <img
                        src={urls[e.id]}
                        alt={e.name}
                        className="w-7 h-7 object-contain"
                        title={e.name}
                      />
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
          {packs.length === 0 && !search.trim() && (
            <p className="text-xs text-muted text-center py-4">
              {t('chat.emojiNoPacks')}
            </p>
          )}
        </div></div>
      </Popover.Content>
    </Popover>
  )
}
