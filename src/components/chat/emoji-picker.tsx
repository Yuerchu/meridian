import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaceSmile, Magnifier } from '@gravity-ui/icons'
import { Button, ScrollShadow, SearchField, Tooltip, TooltipTrigger } from '@/components/base'
import { ChatLoader, EmojiPicker as ProEmojiPicker } from '@/components/base'

import { api } from '@/api'
import type { EmojiInfoResponse, EmojiPackInfoResponse } from '@/types'

interface PackWithEmojis {
  pack: EmojiPackInfoResponse
  emojis: EmojiInfoResponse[]
}

interface StickerItem {
  emoji: EmojiInfoResponse
  packId: string
  packName: string
  url?: string
}

export function EmojiPicker({
  assistantId,
  onSelect,
}: {
  assistantId: string | null
  onSelect: (sticker: { emoji: EmojiInfoResponse; url: string }) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [packs, setPacks] = useState<PackWithEmojis[]>([])
  const [activePackId, setActivePackId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loadedAssistantId, setLoadedAssistantId] = useState<string | null>(null)

  useEffect(() => {
    if (!assistantId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const assignedPacks = await api.listAssistantEmojiPacks(assistantId!)
        const result = await Promise.all(
          assignedPacks.map(async (pack) => ({
            pack,
            emojis: (await api.listEmojis(pack.id)).filter(
              (emoji) => emoji.semantic_status === 'confirmed' && emoji.file_format !== 'lottie',
            ),
          })),
        )
        const resolvedUrls = await Promise.all(
          result.flatMap(({ emojis }) =>
            emojis.map(async (emoji) => [emoji.id, await api.getEmojiFileUrl(emoji.id).catch(() => null)] as const),
          ),
        )

        if (!cancelled) {
          const urlMap = Object.fromEntries(
            resolvedUrls.filter((entry): entry is readonly [string, string] => !!entry[1]),
          )
          const initialPack =
            result.find(({ emojis }) => emojis.some((emoji) => urlMap[emoji.id])) ??
            result.find(({ emojis }) => emojis.length > 0) ??
            result[0]
          setPacks(result)
          setUrls(urlMap)
          setActivePackId(initialPack?.pack.id ?? null)
          setLoadedAssistantId(assistantId)
        }
      } catch {
        if (!cancelled) {
          setPacks([])
          setUrls({})
          setActivePackId(null)
          setLoadedAssistantId(assistantId)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [assistantId])

  // InputBar stays mounted while its assistant changes. Gate the old payload
  // during the new request so a still-open picker can never send a sticker
  // that is not assigned to the current assistant.
  const allItems = useMemo<StickerItem[]>(
    () =>
      loadedAssistantId === assistantId
        ? packs.flatMap(({ pack, emojis }) =>
            emojis.map((emoji) => ({ emoji, packId: pack.id, packName: pack.name, url: urls[emoji.id] })),
          )
        : [],
    [assistantId, loadedAssistantId, packs, urls],
  )
  const displayPacks = loadedAssistantId === assistantId ? packs : []

  // Searching spans every assigned pack. At rest the footer acts as category
  // navigation, keeping the grid compact without losing the pack names that
  // the previous hand-built picker showed above every row.
  const visibleItems = useMemo(
    () => (search.trim() ? allItems : allItems.filter((item) => activePackId === null || item.packId === activePackId)),
    [activePackId, allItems, search],
  )

  const handleSelect = useCallback(
    (id: React.Key | null) => {
      if (id === null) return
      const item = allItems.find(({ emoji }) => emoji.id === String(id))
      if (!item?.url) return
      onSelect({ emoji: item.emoji, url: item.url })
      setOpen(false)
      setSearch('')
    },
    [allItems, onSelect],
  )

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setSearch('')
  }, [])

  if (!assistantId) return null

  return (
    <ProEmojiPicker
      aria-label={t('chat.emoji')}
      isOpen={open}
      selectedKey={null}
      size="md"
      onOpenChange={handleOpenChange}
      onSelectionChange={handleSelect}
    >
      <TooltipTrigger delay={0}>
        <ProEmojiPicker.Trigger
          aria-label={t('chat.emoji')}
          className="touch-hitbox flex size-8 items-center justify-center rounded-lg text-muted hover:bg-default hover:text-foreground"
          onClick={() => {
            // RAC Select normally declines to open an empty collection. This
            // picker still has useful content in that state: the assigned-pack
            // explanation and search shell.
            if (!open) setOpen(true)
          }}
        >
          <FaceSmile className="size-4" />
        </ProEmojiPicker.Trigger>
        <Tooltip>{t('chat.emoji')}</Tooltip>
      </TooltipTrigger>
      <ProEmojiPicker.Popover placement="top end">
        <ProEmojiPicker.Content>
          <SearchField
            fullWidth
            aria-label={t('chat.emojiSearch')}
            value={search}
            variant="secondary"
            onChange={setSearch}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input autoFocus placeholder={t('chat.emojiSearch')} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <ProEmojiPicker.Grid
            aria-label={t('chat.emoji')}
            items={visibleItems}
            renderEmptyState={() =>
              loading || loadedAssistantId !== assistantId ? (
                <ChatLoader.Dots label={t('chat.emojiLoading')} />
              ) : (
                <span data-slot="emoji-picker-empty" className="flex flex-col items-center gap-2">
                  <Magnifier className="size-5" />
                  {search.trim() ? t('chat.emojiNotFound') : t('chat.emojiNoPacks')}
                </span>
              )
            }
          >
            {(item) => (
              <ProEmojiPicker.Item
                id={item.emoji.id}
                disabled={!item.url}
                textValue={`${item.emoji.name} ${item.emoji.tags ?? ''} ${item.packName}`}
              >
                {item.url ? (
                  <img
                    data-slot="emoji-picker-image"
                    src={item.url}
                    alt={item.emoji.name}
                    className="size-7 object-contain"
                  />
                ) : (
                  <span
                    data-slot="emoji-picker-name"
                    className="line-clamp-2 text-center text-xs leading-tight text-muted"
                  >
                    {item.emoji.name}
                  </span>
                )}
              </ProEmojiPicker.Item>
            )}
          </ProEmojiPicker.Grid>

          {displayPacks.length > 0 && (
            <ProEmojiPicker.Footer>
              <ScrollShadow hideScrollBar orientation="horizontal" className="min-w-0 flex-1">
                <div data-slot="emoji-picker-packs" className="flex items-center gap-1 px-1">
                  {displayPacks.map(({ pack }) => (
                    <Button
                      key={pack.id}
                      size="sm"
                      variant="ghost"
                      className={
                        pack.id === activePackId && !search.trim()
                          ? 'h-7 shrink-0 bg-default px-2 text-xs text-foreground'
                          : 'h-7 shrink-0 px-2 text-xs text-muted'
                      }
                      onClick={() => {
                        setActivePackId(pack.id)
                        setSearch('')
                      }}
                    >
                      {pack.name}
                    </Button>
                  ))}
                </div>
              </ScrollShadow>
            </ProEmojiPicker.Footer>
          )}
        </ProEmojiPicker.Content>
      </ProEmojiPicker.Popover>
    </ProEmojiPicker>
  )
}
