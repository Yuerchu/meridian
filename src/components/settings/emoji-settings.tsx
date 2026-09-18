import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpFromLine, Check, Plus, Sparkles, Sticker, TrashBin, Xmark } from '@gravity-ui/icons'
import { Button, Chip, Disclosure, Input, Tooltip, TooltipTrigger } from '@/components/base'
import { ActionBar } from '@/components/base'
import { DataGrid, type DataGridColumn, type DataGridSelection } from '@/components/base'
import { EmptyState } from '@/components/base'
import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { useConfirm } from '@/hooks/use-confirm'
import { SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import type { EmojiInfoResponse, EmojiPackInfoResponse } from '@/types'

interface PackDetail {
  pack: EmojiPackInfoResponse
  emojis: EmojiInfoResponse[]
  urls: Record<string, string>
}

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
 * Escape restores by unmounting the input, which is also why it needs no guard
 * against the blur handler: React fires no blur for an element it removes.
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (editing) {
    return (
      <Input
        fullWidth
        autoFocus
        aria-label={ariaLabel}
        value={draft}
        placeholder={placeholder}
        className="h-8 text-sm"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false)
          const next = draft.trim()
          if (next !== value.trim()) onSave(next)
        }}
        // The grid is a React Aria table and reads keys off the row: Space
        // toggles its selection, Enter actions it, the arrows walk between
        // cells. Inside a text field all four are text, so none of them may
        // reach the row — a name with a space in it came out without one, and
        // selected the row on the way.
        onKeyUp={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          if (event.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <Button
      variant="ghost"
      className="h-8 w-full min-w-0 justify-start rounded-md px-1.5 text-sm font-normal"
      aria-label={`${ariaLabel}: ${value || placeholder}`}
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
    >
      <span data-slot="editable-cell-value" className={value ? 'truncate' : 'truncate text-muted'}>
        {value || placeholder}
      </span>
    </Button>
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
      {unconfirmed && (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null || !emoji.file_name}
            onClick={() => {
              setBusy('suggest')
              void onSuggest(emoji.id).finally(() => setBusy(null))
            }}
          >
            <Sparkles className="size-3.5" />
            {busy === 'suggest' ? t('settings.emoji.suggesting') : t('settings.emoji.suggest')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !shownName(emoji).trim()}
            onClick={() => {
              setBusy('confirm')
              void onConfirm(emoji).finally(() => setBusy(null))
            }}
          >
            <Check className="size-3.5" />
            {t('settings.emoji.confirmSemantic')}
          </Button>
        </>
      )}
      {canDelete && (
        <TooltipTrigger delay={0}>
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            className="text-muted hover:text-danger"
            aria-label={t('settings.emoji.deleteEmoji')}
            onClick={() => onDelete(emoji.id)}
          >
            <TrashBin className="size-3.5" />
          </Button>
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
  const { urls } = detail

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
        minWidth: 240,
        sortFn: (a, b) => shownName(a).localeCompare(shownName(b)),
        cell: (emoji) => (
          <div data-slot="sticker-cell" className="flex min-w-0 items-center gap-2">
            {urls[emoji.id] ? (
              // Lazy because a pack is unbounded and every frame of every GIF
              // is decoded the moment its element exists.
              <img
                data-slot="sticker-thumbnail"
                src={urls[emoji.id]}
                alt=""
                loading="lazy"
                className="size-9 shrink-0 rounded-lg object-contain"
              />
            ) : (
              <div data-slot="sticker-thumbnail-placeholder" className="size-9 shrink-0 rounded-lg bg-default/40" />
            )}
            <EditableCell
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
        ),
      },
      {
        id: 'tags',
        header: t('settings.emoji.tagsColumn'),
        minWidth: 180,
        cell: (emoji) => (
          <EditableCell
            value={shownTags(emoji)}
            placeholder={t('settings.emoji.noTags')}
            ariaLabel={t('settings.emoji.editTags')}
            onSave={(tags) => void save(emoji, { tags })}
          />
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
        width: 104,
        headerClassName: 'whitespace-nowrap',
        // Without this the column sorts as text, and 9 comes after 10.
        sortFn: (a, b) => a.seen_count - b.seen_count,
      },
      {
        id: 'actions',
        header: t('settings.emoji.actionsColumn'),
        align: 'end',
        minWidth: 172,
        // Pinned, because the table is 736px at its narrowest and a phone is
        // not: these buttons sat at the far right of a sideways scroll about
        // 340px long, so reviewing a sticker meant scrolling out to press
        // Confirm and back again to read the next name. Editing a cell and
        // scrolling the row are also the same gesture under a finger. `end`
        // is logical, so it follows the writing direction, and the numeric
        // `minWidth` above is what pinning requires.
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
    [t, urls, canDelete, save, suggest, onDeleteEmoji],
  )

  const rows = useMemo(() => orderForReview(detail.emojis), [detail.emojis])

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
        onSelectionChange={onSelectionChange}
        // The columns' own minimums add up to this; stating it keeps the table
        // from being squeezed below them, and below this width the grid scrolls
        // sideways inside its own container rather than crushing the
        // thumbnails or pushing the page out.
        contentClassName="min-w-[46rem]"
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
      {error && (
        <p data-slot="sticker-grid-error" className="text-xs text-danger">
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
    <Disclosure className="flex w-full flex-col overflow-hidden rounded-lg border border-border">
      {({ isExpanded }) => (
        <>
          <Disclosure.Heading>
            {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto`
                and `shrink-0`, which only mean anything inside a flex container.
                `text-start` undoes the button element's centred UA default. */}
            <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30">
              <Sticker className="w-3.5 h-3.5 shrink-0 text-muted" />
              <span data-slot="pack-name" className="flex-1 truncate">
                {detail.pack.name}
              </span>
              <span data-slot="pack-count" className="text-xs text-muted">
                {detail.emojis.length}
              </span>
              {pending > 0 && <Chip color="warning">{t('settings.emoji.pendingCount', { count: pending })}</Chip>}
              {detail.pack.is_builtin && <Chip className="shrink-0 text-muted">{t('settings.template.builtin')}</Chip>}
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
                  {detail.pack.description && (
                    <p data-slot="pack-description" className="text-xs text-muted">
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
                      <Button variant="outline" onClick={onImport} disabled={!can.importFromDisk}>
                        <ArrowUpFromLine className="w-3.5 h-3.5" />
                        {t('settings.emoji.import')}
                      </Button>
                    )}
                    {onDelete && !detail.pack.is_builtin && (
                      <Button variant="danger-soft" className="ml-auto" onClick={onDelete}>
                        <TrashBin className="w-3.5 h-3.5" />
                        {t('common.delete')}
                      </Button>
                    )}
                  </div>
                  {onImport && !can.importFromDisk && (
                    <p data-slot="pack-import-note" className="text-xs text-muted">
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
        const emojis = await api.listEmojis(pack.id)
        // One round trip per sticker, so they go together: awaited in sequence
        // a collected pack of a few hundred spent whole seconds here.
        const resolved = await Promise.all(
          emojis.map(async (emoji) => [emoji.id, await api.getEmojiFileUrl(emoji.id).catch(() => null)] as const),
        )
        const urls: Record<string, string> = {}
        for (const [id, url] of resolved) if (url) urls[id] = url
        return { pack, emojis, urls }
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
    // The select-all checkbox yields the string `"all"` rather than a set, and
    // it means every row of the array this grid was given.
    if (selection.keys === 'all') return detail.emojis.map((emoji) => emoji.id)
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
      await refresh()
    },
    [confirm, t, refresh],
  )

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) return
    if (!(await confirm({ body: t('settings.confirmDelete.emojis', { count: selectedIds.length }) }))) return
    // One at a time: each delete unlinks a file as well as a row, and the
    // backend takes a pooled connection per call.
    for (const id of selectedIds) await api.deleteEmoji(id)
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
    // Wider than the settings default, and wider than `MasterDetail` too: the
    // panel stopped being a column of fields the moment the stickers became a
    // table, and at `max-w-3xl` that table met its own minimum width and drew a
    // horizontal scrollbar on a desktop with room to spare.
    <SettingsPane className="max-w-4xl">
      <SettingsHeader title={t('settings.emoji.title')} subtitle={t('settings.emoji.subtitle')} />

      <div data-slot="pack-create" className="flex gap-2">
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
        <Button variant="outline" onClick={handleCreate} disabled={!newPackName.trim()}>
          <Plus className="w-3.5 h-3.5" />
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

      {/* Through a portal, because Pro renders `.action-bar` in place and it is
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
            <span data-slot="emoji-selected-count" aria-live="polite" className="text-sm text-muted">
              {t('settings.emoji.selectedCount', { count: selectedIds.length })}
            </span>
          </ActionBar.Prefix>
          <ActionBar.Content>
            <Button variant="ghost" onClick={handleDeleteSelected}>
              <TrashBin className="text-danger" />
              {t('settings.emoji.deleteSelected')}
            </Button>
          </ActionBar.Content>
          <ActionBar.Suffix>
            <TooltipTrigger delay={0}>
              <Button
                iconOnly
                variant="ghost"
                aria-label={t('settings.emoji.clearSelection')}
                onClick={() => setSelection(null)}
              >
                <Xmark />
              </Button>
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
