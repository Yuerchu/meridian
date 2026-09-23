import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaceSmile, Search } from '@keyline-icons/react/two-tone'
import { PromptInput, ScrollShadow, SearchField, Tooltip, TooltipTrigger } from '@/components/base'
import { EmojiPicker as ProEmojiPicker } from '@/components/base'
import { PillTab, PillTabList } from '@/components/base/tabs/pill-tab'

import { api } from '@/api'
import type { EmojiInfoResponse, EmojiPackInfoResponse } from '@/types'
import { StickerGrid } from './sticker-grid'

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
  //
  // The match is made here, against the same name, tags and pack name the
  // item's `textValue` carries: the grid draws what it is given and filters
  // nothing.
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return allItems.filter((item) => activePackId === null || item.packId === activePackId)
    return allItems.filter((item) =>
      `${item.emoji.name} ${item.emoji.tags ?? ''} ${item.packName}`.toLowerCase().includes(query),
    )
  }, [activePackId, allItems, search])

  const gridItems = useMemo(
    () =>
      visibleItems.map((item) => ({
        id: item.emoji.id,
        name: item.emoji.name,
        textValue: `${item.emoji.name} ${item.emoji.tags ?? ''} ${item.packName}`,
        url: item.url,
      })),
    [visibleItems],
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
        {/* The composer's round control rather than the picker's own neutral
            trigger: this picker only ever sits in the composer toolbar, beside
            the `+` and the microphone, and the three are one control family
            (the registry agent-composer's `ai-chat-composer-add-*` button). */}
        <PromptInput.Control
          data-slot="emoji-picker-trigger"
          aria-label={t('chat.emoji')}
          className="touch-hitbox"
          onPress={() => {
            // RAC Select normally declines to open an empty collection. This
            // picker still has useful content in that state: the assigned-pack
            // explanation and search shell.
            if (!open) setOpen(true)
          }}
          leadingIcon={FaceSmile}
        />
        <Tooltip>{t('chat.emoji')}</Tooltip>
      </TooltipTrigger>
      {/* 24rem holds four ~88px cells; the calc keeps it inside a phone's
          viewport, where the container query drops the grid to three. */}
      <ProEmojiPicker.Popover placement="top end" className="w-[24rem] max-w-[calc(100vw-2rem)]">
        <ProEmojiPicker.Content className="@container/stickers">
          <SearchField aria-label={t('chat.emojiSearch')} value={search} onChange={setSearch}>
            {/* The popover is `background-primary`, which in dark is the search
                well's own neutral-800; the registry's search fields off a settings
                card take the secondary fill instead (`settings-storage.tsx`). */}
            <SearchField.Group className="bg-background-secondary-default">
              <SearchField.SearchIcon />
              <SearchField.Input autoFocus placeholder={t('chat.emojiSearch')} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <StickerGrid
            items={gridItems}
            loading={loading || loadedAssistantId !== assistantId}
            onAction={handleSelect}
            empty={
              <span
                data-slot="emoji-picker-empty"
                className="flex flex-col items-center gap-2 p-4 text-caption-1-regular text-text-secondary"
              >
                <Search className="size-5" />
                {search.trim() ? t('chat.emojiNotFound') : t('chat.emojiNoPacks')}
              </span>
            }
          />

          {displayPacks.length > 0 && (
            <ProEmojiPicker.Footer>
              <ScrollShadow hideScrollBar orientation="horizontal" className="min-w-0 flex-1">
                {/* The registry's pill tab in its quiet `gray` style, which is
                    what it is for — a filter row that drives local view state.
                    These were `ghost` Buttons, BoardUI's accent-soft fill,
                    so every pack but the chosen one read as selected. */}
                <PillTabList data-slot="emoji-picker-packs" className="px-1">
                  {displayPacks.map(({ pack }) => (
                    <PillTab
                      key={pack.id}
                      variant="gray"
                      isSelected={pack.id === activePackId && !search.trim()}
                      onSelect={() => {
                        setActivePackId(pack.id)
                        setSearch('')
                      }}
                    >
                      {pack.name}
                    </PillTab>
                  ))}
                </PillTabList>
              </ScrollShadow>
            </ProEmojiPicker.Footer>
          )}
        </ProEmojiPicker.Content>
      </ProEmojiPicker.Popover>
    </ProEmojiPicker>
  )
}
