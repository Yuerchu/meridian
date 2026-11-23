import './emoji-settings.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Key } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { Bin, Check, ChevronRight, Plus, Sparkles, StickyNote, Upload } from '@keyline-icons/react/two-tone'
import { Button as AriaButton, Disclosure, DisclosurePanel, Heading } from 'react-aria-components'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { DataTable, type DataTableColumn } from '@/components/yuerchu-ui/components/data-table/data-table'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { SelectionBar } from '@/components/yuerchu-ui/components/selection-bar/selection-bar'
import { api } from '@/api'
import { forgetStickerUrl, useStickerUrl } from '@/lib/sticker-urls'
import { usePointerPlay, useStickerPlayback } from '@/components/chat/sticker-playback'
import { StickerThumb } from '@/components/chat/sticker-thumb'
import { can } from '@/lib/capabilities'
import { useConfirm } from '@/hooks/use-confirm'
import { EmojiEmbedderSettings } from './emoji-embedder-settings'
import { EmojiSuggestSettings } from './emoji-suggest-settings'
import { SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import type { EmojiInfoResponse, EmojiPackInfoResponse } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

interface PackDetail {
  pack: EmojiPackInfoResponse
  emojis: EmojiInfoResponse[]
}

/**
 * Rows per page of a pack's table. A collected pack grows without anyone
 * asking, and every row is a React Aria collection item holding two text
 * fields and a picture — the table used to hold all of them, and the page
 * asked for every sticker's file up front besides.
 */
export const STICKERS_PER_PAGE = 20

/** Stable identity, so a table whose pack holds no selection never re-renders for it. */
const NO_SELECTION: ReadonlySet<Key> = new Set<Key>()

/**
 * Unconfirmed first, and within that in the order the pack already carries.
 *
 * A OneBot pack collects on its own and grows without anyone asking, so the
 * rows that need a person are the ones that must not be scrolled to. This is
 * the initial order only: clicking a column header hands sorting to the grid.
 */
const REVIEW_ORDER: Record<EmojiInfoResponse['semantic_status'], number> = { pending: 0, suggested: 1, confirmed: 2 }

function orderForReview(emojis: EmojiInfoResponse[]): EmojiInfoResponse[] {
  return [...emojis].sort(
    (a, b) => REVIEW_ORDER[a.semantic_status] - REVIEW_ORDER[b.semantic_status] || a.sort_order - b.sort_order,
  )
}

/**
 * What a sticker is called and tagged, before anyone has confirmed it.
 *
 * A pending sticker's `name` is whatever the file was called and its `tags` are
 * empty; the model's guess lands in the `suggested_*` pair and is what should
 * be shown, so accepting it is one click rather than retyping it. Confirmation
 * moves the guess into the real columns and clears the pair, so past that point
 * the two agree.
 */
function shownName(emoji: EmojiInfoResponse): string {
  return emoji.semantic_status === 'confirmed' ? emoji.name : (emoji.suggested_name ?? emoji.name)
}

function shownTags(emoji: EmojiInfoResponse): string {
  return (emoji.semantic_status === 'confirmed' ? emoji.tags : (emoji.suggested_tags ?? emoji.tags)) ?? ''
}

/**
 * One field of one row, edited in place.
 *
 * Deliberately its own component holding its own draft: the cell renderers live
 * in a `columns` array, and a draft kept in the grid would rebuild that array —
 * and with it the whole RAC collection — on every keystroke. Here a keystroke
 * touches one cell.
 *
 * The cell *is* the base `Input` — the registry field, in its own tertiary
 * well on the grid's secondary surface — rather than text that swaps itself
 * for a field when pressed. Pressing it is editing it; Enter commits by
 * blurring, Escape puts the saved value back and blurs without committing.
 * The caller keys it by `value`, so a save that comes back from the backend
 * remounts it with the new text instead of leaving a stale draft behind.
 */
function EditableCell({
  value,
  placeholder,
  ariaLabel,
  onSave,
}: {
  value: string
  placeholder: string
  ariaLabel: string
  onSave: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  // Escape reverts the draft and blurs in the same tick, before the reset
  // state has landed — the blur handler reads this instead of the draft.
  const cancelled = useRef(false)

  return (
    <div className="m-emoji__field">
      <TextField
        aria-label={ariaLabel}
        value={draft}
        placeholder={placeholder}
        size="sm"
        onChange={setDraft}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false
            return
          }
          const next = draft.trim()
          if (next !== value.trim()) onSave(next)
        }}
        // The table is a React Aria table and reads keys off the row: Space
        // toggles its selection, Enter actions it, Left/Right walk between
        // cells. Inside a text field all of those are text, so none of them may
        // reach the row — a name with a space in it came out without one, and
        // selected the row on the way. Up and Down mean nothing to a one-line
        // field and are how the keyboard leaves it for the next row.
        onKeyUp={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') event.stopPropagation()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') return
          event.stopPropagation()
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          if (event.key === 'Escape') {
            cancelled.current = true
            setDraft(value)
            ;(event.target as HTMLInputElement).blur()
          }
        }}
      />
    </div>
  )
}

/**
 * A row's picture: its file is asked for once the row is near the viewport
 * (so only the page on screen is ever fetched), painted still, and played
 * while a pointer rests on it — the same still-until-pointed-at sticker the
 * picker draws.
 */
function StickerThumbnail({ id }: { id: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const [pointed, pointer] = usePointerPlay()
  const { near, playing } = useStickerPlayback(box, { autoplay: false, explicit: pointed })
  const url = useStickerUrl(near ? id : null)
  return (
    <span ref={box} data-slot="sticker-thumbnail" data-url-state={url.status} className="m-emoji__thumb" {...pointer}>
      {url.status === 'loaded' && <StickerThumb src={url.url} near={near} playing={playing} fallback={null} />}
    </span>
  )
}

/**
 * Per row, so the two long-running actions can say they are running without the
 * grid holding a map of row ids to booleans.
 */
function RowActions({
  emoji,
  canDelete,
  onSuggest,
  onConfirm,
  onDelete,
}: {
  emoji: EmojiInfoResponse
  canDelete: boolean
  onSuggest: (id: string) => Promise<void>
  onConfirm: (emoji: EmojiInfoResponse) => Promise<void>
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'suggest' | 'confirm' | null>(null)
  const unconfirmed = emoji.semantic_status !== 'confirmed'

  return (
    <div data-slot="sticker-row-actions" className="m-emoji__row-actions">
      {/* Icon actions, as the registry's file table has them (settings-storage
          `RowActionButton`): two labelled buttons beside a delete needed a
          column wider than the whole settings width can spare. The label is the
          accessible name and the tooltip. */}
      {unconfirmed && (
        <>
          <TooltipTrigger>
            <Button
              icon={<Sparkles />}
              size="sm"
              variant="ghost"
              aria-label={busy === 'suggest' ? t('settings.emoji.suggesting') : t('settings.emoji.suggest')}
              isPending={busy === 'suggest'}
              isDisabled={busy !== null || !emoji.file_name}
              onPress={() => {
                setBusy('suggest')
                void onSuggest(emoji.id).finally(() => setBusy(null))
              }}
            />
            <Tooltip>{t('settings.emoji.suggest')}</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <Button
              icon={<Check />}
              size="sm"
              variant="ghost"
              aria-label={t('settings.emoji.confirmSemantic')}
              isPending={busy === 'confirm'}
              isDisabled={busy !== null || !shownName(emoji).trim()}
              onPress={() => {
                setBusy('confirm')
                void onConfirm(emoji).finally(() => setBusy(null))
              }}
            />
            <Tooltip>{t('settings.emoji.confirmSemantic')}</Tooltip>
          </TooltipTrigger>
        </>
      )}
      {canDelete && (
        <TooltipTrigger>
          <Button
            icon={<Bin />}
            size="sm"
            variant="ghost"
            aria-label={t('settings.emoji.deleteEmoji')}
            onPress={() => onDelete(emoji.id)}
          />
          <Tooltip>{t('settings.emoji.deleteEmoji')}</Tooltip>
        </TooltipTrigger>
      )}
    </div>
  )
}

/**
 * The stickers of one pack, as rows.
 *
 * This used to be two views of the same table — a thumbnail grid for confirmed
 * stickers and a stack of cards for the ones awaiting a meaning — which hid
 * everything the pack actually knows: tags were invisible once confirmed, and
 * how often a sticker had been seen was shown only while it was still pending.
 * Both are columns now, and there is one row per sticker whatever its state.
 */
function StickerGrid({
  detail,
  selectedKeys,
  onSelectionChange,
  onSaveSemantics,
  onSuggest,
  onDeleteEmoji,
}: {
  detail: PackDetail
  selectedKeys: Iterable<Key>
  onSelectionChange: (keys: Set<Key>) => void
  onSaveSemantics: (emoji: EmojiInfoResponse, patch: { name?: string; tags?: string }) => Promise<void>
  onSuggest: (id: string) => Promise<EmojiInfoResponse>
  onDeleteEmoji: (id: string) => void
}) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const canDelete = !detail.pack.is_builtin

  // A cell has nowhere to put a failure, so both writes report here instead.
  const save = useCallback(
    (emoji: EmojiInfoResponse, patch: { name?: string; tags?: string }) => {
      setError(null)
      return onSaveSemantics(emoji, patch).catch((reason: unknown) => setError(String(reason)))
    },
    [onSaveSemantics],
  )

  const suggest = useCallback(
    (id: string) => {
      setError(null)
      return onSuggest(id).then(
        () => undefined,
        (reason: unknown) => setError(String(reason)),
      )
    },
    [onSuggest],
  )

  const columns = useMemo<DataTableColumn<EmojiInfoResponse>[]>(
    () => [
      {
        id: 'sticker',
        header: t('settings.emoji.stickerColumn'),
        isRowHeader: true,
        sortValue: (emoji) => shownName(emoji),
        // The tags are the name's second line rather than a column of their
        // own: at the settings width (532px) a fourth column left the name two
        // words wide, and the two are read together anyway — what the sticker
        // is called, and what else it answers to.
        cell: (emoji) => (
          <div data-slot="sticker-cell" className="m-emoji__cell">
            <StickerThumbnail id={emoji.id} />
            <div data-slot="sticker-cell-fields" className="m-emoji__fields">
              <div data-slot="sticker-cell-name" className="m-emoji__name-row">
                <EditableCell
                  key={shownName(emoji)}
                  value={shownName(emoji)}
                  placeholder={t('settings.emoji.semanticName')}
                  ariaLabel={t('settings.emoji.editName')}
                  onSave={(name) => void save(emoji, { name })}
                />
                {emoji.semantic_status !== 'confirmed' && <Badge tone="warning">{t('settings.emoji.pending')}</Badge>}
              </div>
              <EditableCell
                key={shownTags(emoji)}
                value={shownTags(emoji)}
                placeholder={t('settings.emoji.noTags')}
                ariaLabel={t('settings.emoji.editTags')}
                onSave={(tags) => void save(emoji, { tags })}
              />
            </div>
          </div>
        ),
      },
      {
        id: 'seen',
        header: t('settings.emoji.seenColumn'),
        align: 'end',
        width: 96,
        sortValue: (emoji) => emoji.seen_count,
        cell: (emoji) => <span className="m-emoji__seen">{emoji.seen_count}</span>,
      },
      {
        id: 'actions',
        header: t('settings.emoji.actionsColumn'),
        align: 'end',
        width: 128,
        cell: (emoji) => (
          <RowActions
            emoji={emoji}
            canDelete={canDelete}
            onSuggest={suggest}
            onConfirm={(target) => save(target, {})}
            onDelete={onDeleteEmoji}
          />
        ),
      },
    ],
    [t, canDelete, save, suggest, onDeleteEmoji],
  )

  const rows = useMemo(() => orderForReview(detail.emojis), [detail.emojis])

  return (
    <div data-slot="sticker-grid" className="m-emoji__grid">
      <DataTable<EmojiInfoResponse>
        aria-label={t('settings.emoji.gridLabel', { pack: detail.pack.name })}
        columns={columns}
        rows={rows}
        getRowId={(emoji) => emoji.id}
        // A builtin pack's stickers cannot be deleted, and deletion is the only
        // thing a selection is for here.
        selectionMode={canDelete ? 'multiple' : 'none'}
        selectedKeys={selectedKeys}
        onSelectionChange={onSelectionChange}
        pageSize={STICKERS_PER_PAGE}
        // A collected pack has no ceiling, so the table keeps its own scroller
        // instead of making the settings page arbitrarily long.
        maxHeight={384}
        renderEmptyState={() => <EmptyState heading={t('settings.emoji.noStickers')} headingLevel={3} size="sm" />}
      />
      {error && (
        <Alert data-slot="sticker-grid-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}
    </div>
  )
}

function PackCard({
  detail,
  selectedKeys,
  onSelectionChange,
  onDelete,
  onImport,
  onDeleteEmoji,
  onSaveSemantics,
  onSuggest,
}: {
  detail: PackDetail
  selectedKeys: Iterable<Key>
  onSelectionChange: (keys: Set<Key>) => void
  onDelete?: () => void
  onImport?: () => void
  onDeleteEmoji: (id: string) => void
  onSaveSemantics: (emoji: EmojiInfoResponse, patch: { name?: string; tags?: string }) => Promise<void>
  onSuggest: (id: string) => Promise<EmojiInfoResponse>
}) {
  const { t } = useTranslation()
  const pending = detail.emojis.filter((emoji) => emoji.semantic_status !== 'confirmed').length

  return (
    // Render prop rather than a controlled `isExpanded`: the open state is only
    // read one level down, so the card keeps its own uncontrolled state and no
    // caller has to hold it.
    <Disclosure className="m-emoji__fold">
      {({ isExpanded }) => (
        <>
          <Heading>
            {/* `text-align: start` undoes the button element's centred UA default. */}
            <AriaButton slot="trigger" className="m-emoji__trigger">
              <StickyNote size={14} aria-hidden className="m-emoji__glyph" />
              <span data-slot="pack-name" onPointerEnter={titleIfTruncated} className="m-emoji__name">
                {detail.pack.name}
              </span>
              <span data-slot="pack-count" className="m-emoji__count">
                {detail.emojis.length}
              </span>
              {pending > 0 && <Badge tone="warning">{t('settings.emoji.pendingCount', { count: pending })}</Badge>}
              {detail.pack.is_builtin && <Badge>{t('settings.template.builtin')}</Badge>}
              <ChevronRight size={14} aria-hidden className="m-emoji__chevron" />
            </AriaButton>
          </Heading>

          {/* `min-height: 0` is load-bearing: the card is a flex column, and a flex
              item's default `min-height: auto` floors it at its content height. */}
          <DisclosurePanel className="m-emoji__panel">
            <div className="m-emoji__body">
              {/* A collapsed panel is only hidden, not unmounted, so the grid
                  has to be gated: every pack's images — GIF and APNG among them
                  — would otherwise be decoded and held as bitmaps on every
                  visit to this page, open or not. The cost is that collapsing
                  drops the content in the same frame as the height animation. */}
              {isExpanded && (
                <>
                  {detail.pack.description && (
                    <p data-slot="pack-description" className="m-emoji__desc">
                      {detail.pack.description}
                    </p>
                  )}

                  <StickerGrid
                    detail={detail}
                    selectedKeys={selectedKeys}
                    onSelectionChange={onSelectionChange}
                    onSaveSemantics={onSaveSemantics}
                    onSuggest={onSuggest}
                    onDeleteEmoji={onDeleteEmoji}
                  />

                  <div data-slot="pack-actions" className="m-emoji__actions">
                    {onImport && (
                      // The picker returns paths on this device and the import
                      // is read by whichever machine the backend is on.
                      <Button icon={<Upload />} variant="secondary" onPress={onImport} isDisabled={!can.importFromDisk}>
                        {t('settings.emoji.import')}
                      </Button>
                    )}
                    {onDelete && !detail.pack.is_builtin && (
                      <span className="m-emoji__aside">
                        <Button icon={<Bin />} variant="destructive" onPress={onDelete}>
                          {t('common.delete')}
                        </Button>
                      </span>
                    )}
                  </div>
                  {onImport && !can.importFromDisk && (
                    <p data-slot="pack-import-note" className="m-emoji__note">
                      {t('capability.importFromDisk')}
                    </p>
                  )}
                </>
              )}
            </div>
          </DisclosurePanel>
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
  // One selection for the page, not one per pack: the bulk bar is fixed to the
  // viewport, and two packs holding selections would stack two of them there.
  const [selection, setSelection] = useState<{ packId: string; keys: Set<Key> } | null>(null)
  const [bulkSuggest, setBulkSuggest] = useState<{ done: number; total: number } | null>(null)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const refresh = useCallback(async () => {
    const packs = await api.listEmojiPacks()
    const result = await Promise.all(
      packs.map(async (pack) => {
        // What the stickers are, not their files: a row asks for its picture
        // once it is on screen (`StickerThumbnail`). Asking here was one IPC
        // round trip — and one whole file as base64 — per sticker in every
        // pack, on every visit and after every edit.
        const emojis = await api.listEmojis(pack.id)
        return { pack, emojis }
      }),
    )
    setDetails(result)
  }, [])

  useEffect(() => {
    refresh().then(() => setLoading(false))
  }, [refresh])

  const selectedIds = useMemo(() => {
    if (!selection) return []
    const detail = details.find((d) => d.pack.id === selection.packId)
    if (!detail) return []
    return [...selection.keys].map(String)
  }, [selection, details])

  const suggestableSelected = useMemo(() => {
    if (!selection) return []
    const detail = details.find((d) => d.pack.id === selection.packId)
    if (!detail) return []
    return detail.emojis.filter(
      (emoji) => selectedIds.includes(emoji.id) && emoji.semantic_status !== 'confirmed' && emoji.file_name,
    )
  }, [selection, details, selectedIds])

  const handleCreate = useCallback(async () => {
    if (!newPackName.trim()) return
    await api.createEmojiPack({ name: newPackName.trim(), description: null })
    setNewPackName('')
    await refresh()
  }, [newPackName, refresh])

  const handleDelete = useCallback(
    async (id: string) => {
      if (
        !(await confirm({
          description: t('settings.confirmDelete.emojiPack'),
          confirmLabel: t('common.delete'),
          tone: 'danger',
        }))
      )
        return
      await api.deleteEmojiPack(id)
      setSelection(null)
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
      await api.importEmojis({ packId, filePaths: paths })
      await refresh()
    },
    [refresh],
  )

  const handleDeleteEmoji = useCallback(
    async (id: string) => {
      if (
        !(await confirm({
          description: t('settings.confirmDelete.emoji'),
          confirmLabel: t('common.delete'),
          tone: 'danger',
        }))
      )
        return
      await api.deleteEmoji(id)
      forgetStickerUrl(id)
      await refresh()
    },
    [confirm, t, refresh],
  )

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) return
    if (
      !(await confirm({
        description: t('settings.confirmDelete.emojis', { count: selectedIds.length }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    // One at a time: each delete unlinks a file as well as a row, and the
    // backend takes a pooled connection per call.
    for (const id of selectedIds) {
      await api.deleteEmoji(id)
      forgetStickerUrl(id)
    }
    setSelection(null)
    await refresh()
  }, [selectedIds, confirm, t, refresh])

  /**
   * The one write path for what a sticker means.
   *
   * `confirm_sticker_semantics` sets name and tags together and is idempotent,
   * so it serves an edit to a confirmed sticker as well as the first
   * confirmation of a pending one — which is what makes "type a name and press
   * Enter" the same act as accepting the model's guess. `rename_emoji` would
   * only move half of it and leave the row unconfirmed.
   */
  const handleSaveSemantics = useCallback(
    async (emoji: EmojiInfoResponse, patch: { name?: string; tags?: string }) => {
      const name = (patch.name ?? shownName(emoji)).trim()
      if (!name) return
      const tags = (patch.tags ?? shownTags(emoji)).trim()
      await api.confirmStickerSemantics({ id: emoji.id, name, tags: tags || null })
      await refresh()
    },
    [refresh],
  )

  const handleSuggest = useCallback(
    async (id: string) => {
      setSuggestError(null)
      const updated = await api.suggestStickerSemantics(id)
      await refresh()
      return updated
    },
    [refresh],
  )

  const handleSuggestSelected = useCallback(async () => {
    if (suggestableSelected.length === 0 || bulkSuggest) return
    setSuggestError(null)
    const ids = suggestableSelected.map((emoji) => emoji.id)
    setBulkSuggest({ done: 0, total: ids.length })
    const failures: string[] = []
    for (const [index, id] of ids.entries()) {
      try {
        await api.suggestStickerSemantics(id)
      } catch (reason) {
        failures.push(String(reason))
      }
      setBulkSuggest({ done: index + 1, total: ids.length })
    }
    await refresh()
    setBulkSuggest(null)
    if (failures.length > 0) {
      setSuggestError(t('settings.emoji.suggestSelectedFailed', { count: failures.length, error: failures[0] }))
    }
  }, [suggestableSelected, bulkSuggest, refresh, t])

  if (loading) {
    return <SettingsSkeleton />
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.emoji.title')} subtitle={t('settings.emoji.subtitle')} />

      <EmojiSuggestSettings />
      <EmojiEmbedderSettings />

      <div data-slot="pack-create" className="m-emoji__create">
        <div className="m-emoji__field">
          <TextField
            value={newPackName}
            onChange={(e) => setNewPackName(e)}
            placeholder={t('settings.emoji.packName')}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') handleCreate()
            }}
          />
        </div>
        <Button icon={<Plus />} variant="secondary" onPress={handleCreate} isDisabled={!newPackName.trim()}>
          {t('settings.emoji.newPack')}
        </Button>
      </div>

      <div data-slot="pack-list" className="m-emoji__list">
        {details.map((d) => (
          <PackCard
            key={d.pack.id}
            detail={d}
            selectedKeys={selection?.packId === d.pack.id ? selection.keys : NO_SELECTION}
            onSelectionChange={(keys) => setSelection(keys.size > 0 ? { packId: d.pack.id, keys } : null)}
            onDelete={() => handleDelete(d.pack.id)}
            onImport={d.pack.kind === 'manual' ? () => handleImport(d.pack.id) : undefined}
            onDeleteEmoji={handleDeleteEmoji}
            onSaveSemantics={handleSaveSemantics}
            onSuggest={handleSuggest}
          />
        ))}
        {details.length === 0 && <EmptyState heading={t('settings.emoji.noPacks')} headingLevel={3} size="sm" />}
      </div>

      {/* The library's bulk bar, not a hand-fixed one: it keeps its own height in
          the flow, so it needs no portal out of this query container, and it
          announces the count and returns focus to the grid when it closes. */}
      <SelectionBar selectedCount={selectedIds.length} onClear={() => setSelection(null)}>
        <Button
          size="sm"
          icon={<Sparkles />}
          variant="secondary"
          isPending={bulkSuggest !== null}
          isDisabled={suggestableSelected.length === 0 || bulkSuggest !== null}
          onPress={() => void handleSuggestSelected()}
        >
          {bulkSuggest ? t('settings.emoji.suggestSelectedProgress', bulkSuggest) : t('settings.emoji.suggestSelected')}
        </Button>
        <Button
          size="sm"
          icon={<Bin />}
          variant="destructive"
          onPress={handleDeleteSelected}
          isDisabled={bulkSuggest !== null}
        >
          {t('settings.emoji.deleteSelected')}
        </Button>
      </SelectionBar>
      {suggestError && (
        <Alert data-slot="emoji-suggest-batch-error" tone="danger" shouldAnnounce>
          {suggestError}
        </Alert>
      )}
      {confirmDialog}
    </SettingsPane>
  )
}
