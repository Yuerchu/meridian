import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaceSmile, Search } from '@keyline-icons/react/two-tone'
import { PromptInput, ScrollShadow, SearchField, Tooltip, TooltipTrigger } from '@/components/base'
import { EmojiPicker as ProEmojiPicker } from '@/components/base'
import { PillTab, PillTabList } from '@/components/base/tabs/pill-tab'

import { api } from '@/api'
import { loadStickerUrl, peekStickerUrl } from '@/lib/sticker-urls'
import { errorMessage } from '@/lib/error-message'
import { ErrorAlert } from '@/components/ui/error-alert'
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
  const [loadedAssistantId, setLoadedAssistantId] = useState<string | null>(null)
  // A failed read used to land on "no sticker packs assigned", which is a
  // statement about the assistant's settings and was false. And a sticker whose
  // picture could not be fetched did nothing when chosen.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectError, setSelectError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!assistantId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)
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
        // Only what the stickers are, not where their pictures are: a URL is
        // asked for by the cell that draws it, once it is near the viewport
        // (`useStickerUrl`). Asking for all of them here was one IPC round
        // trip — and one whole file as base64 — per sticker in every assigned
        // pack, every time the composer mounted.
        if (!cancelled) {
          const initialPack = result.find(({ emojis }) => emojis.length > 0) ?? result[0]
          setPacks(result)
          setActivePackId(initialPack?.pack.id ?? null)
          setLoadedAssistantId(assistantId)
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(errorMessage(err))
          // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- a read-only sticker picker; nothing here is saved
          setPacks([])
          // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- a read-only sticker picker; nothing here is saved
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
  }, [assistantId, attempt])

  // InputBar stays mounted while its assistant changes. Gate the old payload
  // during the new request so a still-open picker can never send a sticker
  // that is not assigned to the current assistant.
  const allItems = useMemo<StickerItem[]>(
    () =>
      loadedAssistantId === assistantId
        ? packs.flatMap(({ pack, emojis }) => emojis.map((emoji) => ({ emoji, packId: pack.id, packName: pack.name })))
        : [],
    [assistantId, loadedAssistantId, packs],
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
      })),
    [visibleItems],
  )

  // The assistant a pending URL lookup was started for, so a lookup that lands
  // after the assistant changed sends nothing.
  const currentAssistant = useRef(assistantId)
  useEffect(() => {
    currentAssistant.current = assistantId
  }, [assistantId])

  const handleSelect = useCallback(
    (id: React.Key | null) => {
      if (id === null) return
      const item = allItems.find(({ emoji }) => emoji.id === String(id))
      if (!item) return
      const send = (url: string) => {
        setSelectError(null)
        onSelect({ emoji: item.emoji, url })
        setOpen(false)
        setSearch('')
      }
      // A cell that was drawn has its URL cached already; one chosen from the
      // keyboard before it was drawn asks now.
      const cached = peekStickerUrl(item.emoji.id)
      if (cached !== undefined) return send(cached)
      const askedFor = assistantId
      loadStickerUrl(item.emoji.id).then(
        (url) => {
          if (currentAssistant.current === askedFor) send(url)
        },
        (err: unknown) => {
          if (currentAssistant.current === askedFor) setSelectError(errorMessage(err))
        },
      )
    },
    [allItems, assistantId, onSelect],
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

          {selectError && (
            <ErrorAlert
              data-slot="emoji-picker-select-error"
              message={selectError}
              onDismiss={() => setSelectError(null)}
            />
          )}
          <StickerGrid
            items={gridItems}
            loading={loading || loadedAssistantId !== assistantId}
            onAction={handleSelect}
            empty={
              loadError ? (
                <ErrorAlert
                  data-slot="emoji-picker-load-error"
                  title={t('chat.emojiLoadFailed')}
                  message={loadError}
                  onRetry={() => setAttempt((n) => n + 1)}
                />
              ) : (
                <span
                  data-slot="emoji-picker-empty"
                  className="flex flex-col items-center gap-2 p-4 text-caption-1-regular text-text-secondary"
                >
                  <Search className="size-5" />
                  {search.trim() ? t('chat.emojiNotFound') : t('chat.emojiNoPacks')}
                </span>
              )
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
