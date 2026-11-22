import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogTrigger } from 'react-aria-components'
import { FaceSmile } from '@keyline-icons/react/two-tone'
import { PromptInput } from '@/components/base'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import {
  EmojiPicker as LibraryEmojiPicker,
  type EmojiPack,
  type EmojiPackItem,
  type EmojiPickerSelection,
} from '@/components/yuerchu-ui/components/emoji-picker/emoji-picker'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { api } from '@/api'
import { loadStickerUrl, peekStickerUrl } from '@/lib/sticker-urls'
import { errorMessage } from '@/lib/error-message'
import { ErrorAlert } from '@/components/ui/error-alert'
import type { EmojiInfoResponse, EmojiPackInfoResponse } from '@/types'
import './emoji-picker.css'

interface PackWithEmojis {
  pack: EmojiPackInfoResponse
  emojis: EmojiInfoResponse[]
}

/**
 * The assistant's sticker packs, in the library's emoji panel, as a popover.
 *
 * The panel always has a Unicode tab. That tab inserts into the draft through
 * `onSelectEmoji`; a sticker is still `onSelect`, after its file URL is known.
 * Search is per pack, and the panel opens on the Unicode tab — both are the
 * library's, not something this wrapper chooses.
 *
 * With `anchorRef` it draws no button of its own and opens from that element
 * instead: the composer reaches it from the `+` menu. Without it, it is the
 * round toolbar control it always was.
 */
export function EmojiPicker({
  assistantId,
  onSelect,
  onSelectEmoji,
  anchorRef,
  isOpen,
  onOpenChange,
}: {
  assistantId: string | null
  onSelect: (sticker: { emoji: EmojiInfoResponse; url: string }) => void
  /** Inserts a Unicode emoji into the draft. The panel's first tab does this. */
  onSelectEmoji?: (emoji: string) => void
  anchorRef?: RefObject<HTMLElement | null>
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [ownOpen, setOwnOpen] = useState(false)
  const open = isOpen ?? ownOpen
  const setOpen = useCallback(
    (next: boolean) => {
      setOwnOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const [loading, setLoading] = useState(false)
  const [packs, setPacks] = useState<PackWithEmojis[]>([])
  const [loadedAssistantId, setLoadedAssistantId] = useState<string | null>(null)
  // A failed read used to land on "no sticker packs assigned", which is a
  // statement about the assistant's settings and was false.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [packError, setPackError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [packAttempt, setPackAttempt] = useState(0)

  useEffect(() => {
    if (!assistantId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)
      setPackError(null)
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
        // Only what the stickers are. A file URL is asked for when that pack's
        // grid is opened (`items` below), not for every assigned pack on mount.
        if (!cancelled) {
          setPacks(result)
          setLoadedAssistantId(assistantId)
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(errorMessage(err))
          // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- a read-only sticker picker; nothing here is saved
          setPacks([])
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

  // InputBar stays mounted while its assistant changes. The previous packs must
  // not stay selectable, or a still-open picker sends a sticker that is not
  // assigned to the current assistant.
  const ready = loadedAssistantId === assistantId && !loading && loadError === null
  const displayPacks = useMemo(() => (ready ? packs : []), [ready, packs])

  const currentAssistant = useRef(assistantId)
  useEffect(() => {
    currentAssistant.current = assistantId
  }, [assistantId])

  const emojiById = useMemo(() => {
    const map = new Map<string, EmojiInfoResponse>()
    for (const { emojis } of displayPacks) {
      for (const emoji of emojis) map.set(emoji.id, emoji)
    }
    return map
  }, [displayPacks])

  const libraryPacks = useMemo<EmojiPack[]>(
    () =>
      displayPacks.map(({ pack, emojis }) => ({
        id: pack.id,
        label: pack.name,
        kind: 'sticker',
        items:
          emojis.length === 0
            ? []
            : () => loadPackItems(emojis, assistantId, currentAssistant, setPackError, packAttempt),
      })),
    [assistantId, displayPacks, packAttempt],
  )

  const close = useCallback(() => {
    setOpen(false)
    setPackError(null)
  }, [setOpen])

  const handleSelectItem = useCallback(
    (selection: EmojiPickerSelection) => {
      if (selection.kind !== 'custom') return
      if (currentAssistant.current !== assistantId) return
      const emoji = emojiById.get(selection.id)
      if (!emoji || selection.item.src === '') return
      setPackError(null)
      onSelect({ emoji, url: selection.item.src })
      close()
    },
    [assistantId, close, emojiById, onSelect],
  )

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next) setPackError(null)
    },
    [setOpen],
  )

  if (!assistantId) return null

  const body = loadError ? (
    <ErrorAlert
      data-slot="emoji-picker-load-error"
      title={t('chat.emojiLoadFailed')}
      message={loadError}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  ) : !ready ? (
    <div className="m-emoji-picker__loading">
      <Spinner size="sm" aria-label={t('common.loading')} />
    </div>
  ) : (
    <>
      {packError !== null && (
        <ErrorAlert
          data-slot="emoji-picker-pack-error"
          message={packError}
          onRetry={() => setPackAttempt((n) => n + 1)}
        />
      )}
      {displayPacks.length === 0 && (
        <p className="m-emoji-picker__note" role="status">
          {t('chat.emojiNoPacks')}
        </p>
      )}
      <LibraryEmojiPicker
        aria-label={t('chat.emoji')}
        packs={libraryPacks}
        onSelect={(emoji) => {
          onSelectEmoji?.(emoji)
          close()
        }}
        onSelectItem={handleSelectItem}
      />
    </>
  )

  const popover = (
    <Popover placement={anchorRef ? 'top start' : 'top end'} triggerRef={anchorRef} className="m-emoji-picker__popover">
      <Dialog aria-label={t('chat.emoji')}>{body}</Dialog>
    </Popover>
  )

  return (
    <DialogTrigger isOpen={open} onOpenChange={handleOpenChange}>
      {!anchorRef && (
        <TooltipTrigger>
          {/* The composer's round control rather than a labelled button: this
              picker only ever sits in the composer toolbar, beside the `+` and
              the microphone, and the three are one control family. */}
          <PromptInput.Control
            data-slot="emoji-picker-trigger"
            aria-label={t('chat.emoji')}
            className="touch-hitbox"
            onPress={() => {
              if (!open) setOpen(true)
            }}
            leadingIcon={FaceSmile}
          />
          <Tooltip>{t('chat.emoji')}</Tooltip>
        </TooltipTrigger>
      )}
      {popover}
    </DialogTrigger>
  )
}

function packItem(emoji: EmojiInfoResponse, src: string): EmojiPackItem {
  const tags = emoji.tags
  if (tags === null || tags.trim() === '') return { id: emoji.id, label: emoji.name, src }
  const keywords = tags.split(/\s+/).filter((tag) => tag !== '')
  return keywords.length > 0
    ? { id: emoji.id, label: emoji.name, keywords, src }
    : { id: emoji.id, label: emoji.name, src }
}

/**
 * File URLs for one pack, asked when that pack's grid opens.
 *
 * One broken file does not hide the rest: those stay selectable, and the
 * reason is reported. Every file failing rejects, so the library shows its
 * retry instead of an empty grid that would read as "this pack has nothing".
 */
async function loadPackItems(
  emojis: readonly EmojiInfoResponse[],
  askedFor: string | null,
  currentAssistant: RefObject<string | null>,
  report: (message: string | null) => void,
  // Read by the caller so a retry builds a new loader. The library reloads a
  // pack when that loader's pack object is new; the number itself is not sent.
  _attempt: number,
): Promise<EmojiPackItem[]> {
  const loaded = await Promise.all(
    emojis.map(async (emoji) => {
      const cached = peekStickerUrl(emoji.id)
      if (cached !== undefined) return { emoji, src: cached, error: null }
      try {
        return { emoji, src: await loadStickerUrl(emoji.id), error: null }
      } catch (err) {
        return { emoji, src: '', error: errorMessage(err) }
      }
    }),
  )
  if (currentAssistant.current !== askedFor) return []
  const failed = loaded.find((item) => item.error !== null)
  report(failed?.error ?? null)
  const ok = loaded.flatMap((item) => (item.src === '' ? [] : [packItem(item.emoji, item.src)]))
  if (ok.length === 0) throw new Error(failed?.error ?? 'sticker file missing')
  return ok
}
