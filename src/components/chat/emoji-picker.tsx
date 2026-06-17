import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Smile, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setOpen(!open)}
        title={t('chat.emoji')}
      >
        <Smile className="w-4 h-4" />
      </Button>

      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-72 bg-popover border border-border rounded-lg shadow-lg z-50">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={t('chat.emojiSearch')}
                className="pl-7 h-7 text-xs"
              />
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto p-2">
            {search.trim() ? (
              <div className="grid grid-cols-6 gap-1">
                {searchResults.map((e) => (
                  <button
                    key={e.id}
                    className="p-1 rounded hover:bg-accent/50 transition-colors"
                    onClick={() => handleSelect(e)}
                    title={e.name}
                  >
                    <img
                      src={urls[e.id]}
                      alt={e.name}
                      className="w-7 h-7 object-contain"
                    />
                  </button>
                ))}
                {searchResults.length === 0 && (
                  <p className="col-span-6 text-xs text-muted-foreground text-center py-3">
                    {t('chat.emojiNotFound')}
                  </p>
                )}
              </div>
            ) : (
              packs.map(({ pack, emojis }) => (
                <div key={pack.id} className="mb-2">
                  <p className="text-[10px] text-muted-foreground font-medium mb-1 px-1">
                    {pack.name}
                  </p>
                  <div className="grid grid-cols-6 gap-1">
                    {emojis.map((e) => (
                      <button
                        key={e.id}
                        className="p-1 rounded hover:bg-accent/50 transition-colors"
                        onClick={() => handleSelect(e)}
                        title={e.name}
                      >
                        <img
                          src={urls[e.id]}
                          alt={e.name}
                          className="w-7 h-7 object-contain"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
            {packs.length === 0 && !search.trim() && (
              <p className="text-xs text-muted-foreground text-center py-4">
                {t('chat.emojiNoPacks')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
