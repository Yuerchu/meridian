import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SortDescriptor } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { Bin, Check, Plus, Sparkles, StickyNote, Upload, X } from '@keyline-icons/react/two-tone'
import { Button, Chip, Disclosure, Input, Tooltip, TooltipTrigger } from '@/components/base'
import { ActionBar } from '@/components/base'
import { DataGrid, type DataGridColumn, type DataGridSelection } from '@/components/base'
import { EmptyState } from '@/components/base'
import { Pagination } from '@/components/base'
import { api } from '@/api'
import { forgetStickerUrl, useStickerUrl } from '@/lib/sticker-urls'
import { usePointerPlay, useStickerPlayback } from '@/components/chat/sticker-playback'
import { StickerThumb } from '@/components/chat/sticker-thumb'
import { can } from '@/lib/capabilities'
import { useConfirm } from '@/hooks/use-confirm'
import { SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import type { EmojiInfoResponse, EmojiPackInfoResponse } from '@/types'

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

/** Stable identity, so a grid whose pack holds no selection never re-renders for it. */
const NO_SELECTION: DataGridSelection = new Set<string>()

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
    <Input
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      size="small"
      fieldClassName="min-w-0 flex-1"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false
          return
        }
        const next = draft.trim()
        if (next !== value.trim()) onSave(next)
      }}
      // The grid is a React Aria table and reads keys off the row: Space
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
    <span
      ref={box}
      data-slot="sticker-thumbnail"
      data-url-state={url.status}
      className="flex size-9 shrink-0 overflow-hidden rounded-lg bg-background-secondary-default/40"
      {...pointer}
    >
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
    <div data-slot="sticker-row-actions" className="flex items-center justify-end gap-1">
      {/* Icon actions, as the registry's file table has them (settings-storage
          `RowActionButton`): two labelled buttons beside a delete needed a
          column wider than the whole settings width can spare. The label is the
          accessible name and the tooltip. */}
      {unconfirmed && (
        <>
          <TooltipTrigger delay={0}>
            <Button
              iconOnly
              leadingIcon={Sparkles}
              size="small"
              variant="neutral"
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
          <TooltipTrigger delay={0}>
            <Button
              iconOnly
              leadingIcon={Check}
              size="small"
              variant="neutral"
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
        <TooltipTrigger delay={0}>
          <Button
            iconOnly
            leadingIcon={Bin}
            size="small"
            variant="neutral"
            className="hover:text-status-danger"
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
  selectedKeys: DataGridSelection
  onSelectionChange: (keys: DataGridSelection) => void
  onSaveSemantics: (emoji: EmojiInfoResponse, patch: { name?: string; tags?: string }) => Promise<void>
  onSuggest: (id: string) => Promise<EmojiInfoResponse>
  onDeleteEmoji: (id: string) => void
}) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const canDelete = !detail.pack.is_builtin
  const [page, setPage] = useState(1)
  // Sorting is held here rather than left to the grid, because the grid only
  // ever sees one page: sorting that page alone would put the smallest of
  // twenty first, not the smallest of the pack.
  const [sort, setSort] = useState<SortDescriptor | undefined>(undefined)

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

  const columns = useMemo<DataGridColumn<EmojiInfoResponse>[]>(
    () => [
      {
        id: 'sticker',
        header: t('settings.emoji.stickerColumn'),
        isRowHeader: true,
        allowsSorting: true,
        sortFn: (a, b) => shownName(a).localeCompare(shownName(b)),
        // The tags are the name's second line rather than a column of their
        // own: at the settings width (532px) a fourth column left the name two
        // words wide, and the two are read together anyway — what the sticker
        // is called, and what else it answers to.
        cell: (emoji) => (
          <div data-slot="sticker-cell" className="flex min-w-0 items-center gap-2">
            <StickerThumbnail id={emoji.id} />
            <div data-slot="sticker-cell-fields" className="flex min-w-0 flex-1 flex-col gap-1">
              <div data-slot="sticker-cell-name" className="flex min-w-0 items-center gap-2">
                <EditableCell
                  key={shownName(emoji)}
                  value={shownName(emoji)}
                  placeholder={t('settings.emoji.semanticName')}
                  ariaLabel={t('settings.emoji.editName')}
                  onSave={(name) => void save(emoji, { name })}
                />
                {emoji.semantic_status !== 'confirmed' && (
                  <Chip color="warning" className="shrink-0">
                    {t('settings.emoji.pending')}
                  </Chip>
                )}
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
        accessorKey: 'seen_count',
        align: 'end',
        allowsSorting: true,
        // Wide enough for the header plus its sort caret: a narrower column
        // wraps the label one character per line and drags the whole header
        // row down with it.
        headerClassName: 'w-24 whitespace-nowrap',
        // Without this the column sorts as text, and 9 comes after 10.
        sortFn: (a, b) => a.seen_count - b.seen_count,
      },
      {
        id: 'actions',
        header: t('settings.emoji.actionsColumn'),
        align: 'end',
        // Three 32px icon actions (suggest, confirm, delete) and the padding.
        headerClassName: 'w-32',
        // Pinned, because below the settings width — a phone — the table
        // scrolls sideways, and reviewing a sticker would otherwise mean
        // scrolling out to press Confirm and back again to read the next name.
        // Editing a cell and scrolling the row are also the same gesture under
        // a finger. `end` is logical, so it follows the writing direction.
        pinned: 'end',
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

  const sorted = useMemo(() => {
    const review = orderForReview(detail.emojis)
    const column = sort && columns.find((c) => c.id === sort.column)
    if (!column?.sortFn) return review
    const out = [...review].sort(column.sortFn)
    return sort?.direction === 'descending' ? out.reverse() : out
  }, [detail.emojis, sort, columns])
  const totalPages = Math.max(1, Math.ceil(sorted.length / STICKERS_PER_PAGE))
  // A delete can leave the page past the end; the last page stands in for it.
  const current = Math.min(page, totalPages)
  const rows = useMemo(
    () => sorted.slice((current - 1) * STICKERS_PER_PAGE, current * STICKERS_PER_PAGE),
    [sorted, current],
  )

  // A selection is of rows the reader can see: turning the page or re-sorting
  // drops it, and "select all" means this page, not the pack.
  const select = useCallback(
    (keys: DataGridSelection) => onSelectionChange(keys === 'all' ? new Set(rows.map((emoji) => emoji.id)) : keys),
    [onSelectionChange, rows],
  )
  const turnTo = useCallback(
    (next: number) => {
      setPage(next)
      onSelectionChange(new Set())
    },
    [onSelectionChange],
  )

  return (
    <div data-slot="sticker-grid" className="space-y-2">
      <DataGrid<EmojiInfoResponse>
        aria-label={t('settings.emoji.gridLabel', { pack: detail.pack.name })}
        variant="secondary"
        columns={columns}
        data={rows}
        getRowId={(emoji) => emoji.id}
        // A builtin pack's stickers cannot be deleted, and deletion is the only
        // thing a selection is for here.
        selectionMode={canDelete ? 'multiple' : 'none'}
        showSelectionCheckboxes={canDelete}
        selectedKeys={selectedKeys}
        onSelectionChange={select}
        sortDescriptor={sort}
        onSortChange={(next) => {
          setSort(next)
          turnTo(1)
        }}
        // Fixed layout: the header widths are the widths and the sticker column
        // takes the rest, about 220px at the settings width (532px). Below
        // 32rem the grid scrolls sideways inside its own container rather than
        // crushing the thumbnails or pushing the page out.
        contentClassName="min-w-lg table-fixed"
        // A collected pack has no ceiling, so the grid keeps its own scroller
        // instead of making the settings page arbitrarily long.
        scrollContainerClassName="max-h-96 overflow-y-auto overscroll-contain"
        renderEmptyState={() => (
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Title>{t('settings.emoji.noStickers')}</EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        )}
      />
      <Pagination
        page={current}
        totalPages={totalPages}
        onChange={turnTo}
        aria-label={t('settings.emoji.pagination', { pack: detail.pack.name })}
        previousLabel={t('settings.emoji.previousPage')}
        nextLabel={t('settings.emoji.nextPage')}
        pageLabel={(n) => t('settings.emoji.goToPage', { page: n })}
      />
      {error && (
        <p data-slot="sticker-grid-error" className="text-caption-1-regular text-status-danger">
          {error}
        </p>
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
  selectedKeys: DataGridSelection
  onSelectionChange: (keys: DataGridSelection) => void
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
    <Disclosure className="flex w-full flex-col overflow-hidden rounded-lg border border-border-button-default">
      {({ isExpanded }) => (
        <>
          <Disclosure.Heading>
            {/* `flex` is not optional: Disclosure.Indicator carries `shrink-0`,
                which only means something inside a flex container.
                `text-start` undoes the button element's centred UA default. */}
            <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-body-regular transition-colors outline-none hover:bg-background-primary-hover/30 focus-visible:bg-background-secondary-default/30">
              <StickyNote className="w-3.5 h-3.5 shrink-0 text-text-secondary" />
              <span data-slot="pack-name" className="flex-1 truncate">
                {detail.pack.name}
              </span>
              <span data-slot="pack-count" className="text-caption-1-regular text-text-secondary">
                {detail.emojis.length}
              </span>
              {pending > 0 && <Chip color="warning">{t('settings.emoji.pendingCount', { count: pending })}</Chip>}
              {detail.pack.is_builtin && (
                <Chip className="shrink-0 text-text-secondary">{t('settings.template.builtin')}</Chip>
              )}
              <Disclosure.Indicator className="size-4 shrink-0 text-text-secondary" />
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
                  {detail.pack.description && (
                    <p data-slot="pack-description" className="text-caption-1-regular text-text-secondary">
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

                  <div data-slot="pack-actions" className="flex items-center gap-2">
                    {onImport && (
                      // The picker returns paths on this device and the import
                      // is read by whichever machine the backend is on.
                      <Button
                        leadingIcon={Upload}
                        variant="secondary"
                        onPress={onImport}
                        isDisabled={!can.importFromDisk}
                      >
                        {t('settings.emoji.import')}
                      </Button>
                    )}
                    {onDelete && !detail.pack.is_builtin && (
                      <Button leadingIcon={Bin} variant="danger" className="ml-auto" onPress={onDelete}>
                        {t('common.delete')}
                      </Button>
                    )}
                  </div>
                  {onImport && !can.importFromDisk && (
                    <p data-slot="pack-import-note" className="text-caption-1-regular text-text-secondary">
                      {t('capability.importFromDisk')}
                    </p>
                  )}
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
  // One selection for the page, not one per pack: the bulk bar is fixed to the
  // viewport, and two packs holding selections would stack two of them there.
  const [selection, setSelection] = useState<{ packId: string; keys: DataGridSelection } | null>(null)
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
    // The grid turns "all" into the ids of the page it shows before it gets
    // here, so a bare "all" never arrives; were it to, it would mean a whole
    // pack nobody can see, and deleting that is not what anyone pressed.
    if (selection.keys === 'all') return []
    return [...selection.keys].map(String)
  }, [selection, details])

  const handleCreate = useCallback(async () => {
    if (!newPackName.trim()) return
    await api.createEmojiPack({ name: newPackName.trim(), description: null })
    setNewPackName('')
    await refresh()
  }, [newPackName, refresh])

  const handleDelete = useCallback(
    async (id: string) => {
      if (!(await confirm({ body: t('settings.confirmDelete.emojiPack') }))) return
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
      if (!(await confirm({ body: t('settings.confirmDelete.emoji') }))) return
      await api.deleteEmoji(id)
      forgetStickerUrl(id)
      await refresh()
    },
    [confirm, t, refresh],
  )

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) return
    if (!(await confirm({ body: t('settings.confirmDelete.emojis', { count: selectedIds.length }) }))) return
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
      const updated = await api.suggestStickerSemantics(id)
      await refresh()
      return updated
    },
    [refresh],
  )

  if (loading) {
    return <SettingsSkeleton />
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.emoji.title')} subtitle={t('settings.emoji.subtitle')} />

      <div data-slot="pack-create" className="flex gap-2">
        <Input
          value={newPackName}
          onChange={(e) => setNewPackName(e.target.value)}
          placeholder={t('settings.emoji.packName')}
          fieldClassName="min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') handleCreate()
          }}
        />
        <Button leadingIcon={Plus} variant="secondary" onPress={handleCreate} isDisabled={!newPackName.trim()}>
          {t('settings.emoji.newPack')}
        </Button>
      </div>

      <div data-slot="pack-list" className="space-y-1">
        {details.map((d) => (
          <PackCard
            key={d.pack.id}
            detail={d}
            selectedKeys={selection?.packId === d.pack.id ? selection.keys : NO_SELECTION}
            onSelectionChange={(keys) =>
              setSelection(keys === 'all' || keys.size > 0 ? { packId: d.pack.id, keys } : null)
            }
            onDelete={() => handleDelete(d.pack.id)}
            onImport={d.pack.kind === 'manual' ? () => handleImport(d.pack.id) : undefined}
            onDeleteEmoji={handleDeleteEmoji}
            onSaveSemantics={handleSaveSemantics}
            onSuggest={handleSuggest}
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

      {/* Through a portal, because ActionBar renders itself in place and it is
          `position: fixed`. This pane is a query container now, and
          `container-type` brings `contain: layout` with it — which makes the
          container the containing block for its fixed descendants. Left here,
          the bar would drop out of the viewport and into the pane, scrolling
          away with the table it exists to stay clear of. */}
      {createPortal(
        <ActionBar data-slot="emoji-bulk-bar" isOpen={selectedIds.length > 0}>
          <ActionBar.Prefix>
            {/* The count is the only thing that says a selection exists, so it
              announces itself rather than only appearing. */}
            <span data-slot="emoji-selected-count" aria-live="polite" className="text-body-regular text-text-secondary">
              {t('settings.emoji.selectedCount', { count: selectedIds.length })}
            </span>
          </ActionBar.Prefix>
          <ActionBar.Content>
            <Button leadingIcon={Bin} variant="danger" onPress={handleDeleteSelected}>
              {t('settings.emoji.deleteSelected')}
            </Button>
          </ActionBar.Content>
          <ActionBar.Suffix>
            <TooltipTrigger delay={0}>
              <Button
                iconOnly
                leadingIcon={X}
                size="small"
                variant="neutral"
                aria-label={t('settings.emoji.clearSelection')}
                onPress={() => setSelection(null)}
              />
              <Tooltip>{t('settings.emoji.clearSelection')}</Tooltip>
            </TooltipTrigger>
          </ActionBar.Suffix>
        </ActionBar>,
        document.body,
      )}
      {confirmDialog}
    </SettingsPane>
  )
}
