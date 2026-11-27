import './emoji-settings.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bin,
  Check,
  FolderOpen,
  Plus,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  Upload,
} from '@keyline-icons/react/two-tone'
import { Button as AriaButton } from 'react-aria-components'
import { FileDetails } from '@/components/yuerchu-ui/blocks/file-details/file-details'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Checkbox } from '@/components/yuerchu-ui/components/checkbox/checkbox'
import { Dialog, DialogFooter } from '@/components/yuerchu-ui/components/dialog/dialog'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { ImageViewer, type ImageViewerImage } from '@/components/yuerchu-ui/components/image-viewer/image-viewer'
import { PathBar, type PathSegment } from '@/components/yuerchu-ui/components/path-bar/path-bar'
import { SearchField } from '@/components/yuerchu-ui/components/search-field/search-field'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { SelectionBar } from '@/components/yuerchu-ui/components/selection-bar/selection-bar'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { FileManager } from '@/components/yuerchu-ui/templates/file-manager/file-manager'
import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { forgetStickerUrl, useStickerUrl } from '@/lib/sticker-urls'
import { isRemote } from '@/lib/transport'
import { titleIfTruncated } from '@/lib/truncation'
import { usePointerPlay, useStickerPlayback } from '@/components/chat/sticker-playback'
import { StickerThumb } from '@/components/chat/sticker-thumb'
import { useConfirm } from '@/hooks/use-confirm'
import { EmojiEmbedderSettings } from './emoji-embedder-settings'
import { EmojiSuggestSettings } from './emoji-suggest-settings'
import { SettingsPane, SettingsSelect, SettingsSkeleton } from './primitives'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import type { EmojiInfoResponse, EmojiPackInfoResponse } from '@/types'

interface PackDetail {
  pack: EmojiPackInfoResponse
  emojis: EmojiInfoResponse[]
}

type StatusFilter = 'all' | 'pending' | 'confirmed'
type SortOrder = 'review' | 'seenDesc' | 'seenAsc' | 'name'

const ROOT_PATH_ID = '__packs_root__'

/**
 * Stickers per page inside a pack. A collected pack grows without anyone
 * asking, and paging keeps DOM size and IPC file reads bounded to the page
 * on screen.
 */
export const STICKERS_PER_PAGE = 20

const EMPTY_SELECTION: ReadonlySet<string> = new Set()

const REVIEW_ORDER: Record<EmojiInfoResponse['semantic_status'], number> = { pending: 0, suggested: 1, confirmed: 2 }

function shownName(emoji: EmojiInfoResponse): string {
  return emoji.semantic_status === 'confirmed' ? emoji.name : (emoji.suggested_name ?? emoji.name)
}

function shownTags(emoji: EmojiInfoResponse): string {
  return (emoji.semantic_status === 'confirmed' ? emoji.tags : (emoji.suggested_tags ?? emoji.tags)) ?? ''
}

function parseTagList(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function sortEmojis(emojis: EmojiInfoResponse[], order: SortOrder): EmojiInfoResponse[] {
  const list = [...emojis]
  switch (order) {
    case 'review':
      return list.sort(
        (a, b) => REVIEW_ORDER[a.semantic_status] - REVIEW_ORDER[b.semantic_status] || a.sort_order - b.sort_order,
      )
    case 'seenDesc':
      return list.sort((a, b) => b.seen_count - a.seen_count || a.sort_order - b.sort_order)
    case 'seenAsc':
      return list.sort((a, b) => a.seen_count - b.seen_count || a.sort_order - b.sort_order)
    case 'name':
      return list.sort((a, b) => shownName(a).localeCompare(shownName(b)) || a.sort_order - b.sort_order)
  }
}

function StickerActions({
  emoji,
  canDelete,
  labelled = false,
  onSuggest,
  onConfirm,
  onDelete,
}: {
  emoji: EmojiInfoResponse
  canDelete: boolean
  labelled?: boolean
  onSuggest: (id: string) => Promise<void>
  onConfirm: (emoji: EmojiInfoResponse) => Promise<void>
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'suggest' | 'confirm' | null>(null)
  const unconfirmed = emoji.semantic_status !== 'confirmed'

  if (labelled) {
    return (
      <div data-slot="sticker-inspector-actions" className="m-emoji__inspector-actions">
        {unconfirmed && (
          <>
            <Button
              icon={<Sparkles />}
              size="sm"
              variant="secondary"
              isPending={busy === 'suggest'}
              isDisabled={busy !== null || !emoji.file_name}
              onPress={() => {
                setBusy('suggest')
                void onSuggest(emoji.id).finally(() => setBusy(null))
              }}
            >
              {busy === 'suggest' ? t('settings.emoji.suggesting') : t('settings.emoji.suggest')}
            </Button>
            <Button
              icon={<Check />}
              size="sm"
              isPending={busy === 'confirm'}
              isDisabled={busy !== null || !shownName(emoji).trim()}
              onPress={() => {
                setBusy('confirm')
                void onConfirm(emoji).finally(() => setBusy(null))
              }}
            >
              {t('settings.emoji.confirmSemantic')}
            </Button>
          </>
        )}
        {canDelete && (
          <Button icon={<Bin />} size="sm" variant="destructive" onPress={() => onDelete(emoji.id)}>
            {t('common.delete')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div data-slot="sticker-row-actions" className="m-emoji__tile-actions">
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
 * Large preview stage inside `FileDetails`, clicking opens the full-screen
 * `ImageViewer` lightbox.
 */
function InspectorPreview({
  emoji,
  canDelete,
  onSuggest,
  onConfirm,
  onDelete,
  onPreview,
}: {
  emoji: EmojiInfoResponse
  canDelete: boolean
  onSuggest: (id: string) => Promise<void>
  onConfirm: (emoji: EmojiInfoResponse) => Promise<void>
  onDelete: (id: string) => void
  onPreview: (image: ImageViewerImage) => void
}) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const [pointed, pointer] = usePointerPlay()
  const { near, playing } = useStickerPlayback(box, { autoplay: true, explicit: pointed })
  const url = useStickerUrl(emoji.id)
  const label = shownName(emoji)

  return (
    <div className="m-emoji__inspector-preview">
      <div ref={box} className="m-emoji__inspector-stage" {...pointer}>
        <AriaButton
          className="m-emoji__preview-btn"
          aria-label={t('settings.emoji.previewSticker', { name: label })}
          isDisabled={url.status !== 'loaded'}
          onPress={() => {
            if (url.status === 'loaded') {
              onPreview({ id: emoji.id, src: url.url, alt: label, title: label })
            }
          }}
        >
          <span className="m-emoji__inspector-thumb">
            {url.status === 'loaded' && <StickerThumb src={url.url} near={near} playing={playing} fallback={null} />}
          </span>
        </AriaButton>
      </div>
      <StickerActions
        emoji={emoji}
        canDelete={canDelete}
        labelled
        onSuggest={onSuggest}
        onConfirm={onConfirm}
        onDelete={onDelete}
      />
    </div>
  )
}

/**
 * Clean gallery tile for one sticker: large readable artwork with hover
 * playback, lightweight caption, and click-to-inspect into `FileDetails`.
 */
function StickerTile({
  emoji,
  canDelete,
  selected,
  inspected,
  onToggleSelected,
  onInspect,
  onSave,
  onSuggest,
  onDelete,
}: {
  emoji: EmojiInfoResponse
  canDelete: boolean
  selected: boolean
  inspected: boolean
  onToggleSelected: (checked: boolean) => void
  onInspect: () => void
  onSave: (emoji: EmojiInfoResponse, patch: { name?: string; tags?: string }) => Promise<void>
  onSuggest: (id: string) => Promise<void>
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const [pointed, pointer] = usePointerPlay()
  const { near, playing } = useStickerPlayback(box, { autoplay: false, explicit: pointed })
  const url = useStickerUrl(near ? emoji.id : null)
  const label = shownName(emoji)
  const tags = shownTags(emoji)
  const unconfirmed = emoji.semantic_status !== 'confirmed'

  return (
    <article
      data-slot="sticker-card"
      data-selected={selected || undefined}
      data-inspected={inspected || undefined}
      data-pending={unconfirmed || undefined}
      className="m-emoji__tile"
    >
      <div
        ref={box}
        data-slot="sticker-thumbnail"
        data-url-state={url.status}
        className="m-emoji__tile-stage"
        {...pointer}
      >
        {canDelete && (
          <div className="m-emoji__tile-check">
            <Checkbox
              aria-label={t('settings.emoji.selectSticker', { name: label })}
              isSelected={selected}
              onChange={onToggleSelected}
            />
          </div>
        )}
        {unconfirmed && (
          <div className="m-emoji__tile-badges">
            <Badge tone="warning">{t('settings.emoji.pending')}</Badge>
          </div>
        )}
        <AriaButton
          className="m-emoji__preview-btn"
          aria-label={t('settings.emoji.inspectSticker', { name: label })}
          aria-pressed={inspected}
          onPress={onInspect}
        >
          <span className="m-emoji__thumb">
            {url.status === 'loaded' && <StickerThumb src={url.url} near={near} playing={playing} fallback={null} />}
          </span>
        </AriaButton>
      </div>

      <div className="m-emoji__tile-body">
        <AriaButton className="m-emoji__tile-title-btn" onPress={onInspect}>
          <span data-slot="sticker-name" onPointerEnter={titleIfTruncated} className="m-emoji__tile-title">
            {label}
          </span>
        </AriaButton>
        <span onPointerEnter={titleIfTruncated} className="m-emoji__tile-tags">
          {tags || t('settings.emoji.noTags')}
        </span>
      </div>

      <div className="m-emoji__tile-footer">
        <span className="m-emoji__seen">{t('settings.emoji.seenCount', { count: emoji.seen_count })}</span>
        <StickerActions
          emoji={emoji}
          canDelete={canDelete}
          onSuggest={onSuggest}
          onConfirm={(target) => onSave(target, {})}
          onDelete={onDelete}
        />
      </div>
    </article>
  )
}

export function EmojiSettings() {
  const { t } = useTranslation()
  const [details, setDetails] = useState<PackDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [activePackId, setActivePackId] = useState<string | null>(null)
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('review')
  const [page, setPage] = useState(1)
  const [showModelConfig, setShowModelConfig] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newPackName, setNewPackName] = useState('')
  const [selection, setSelection] = useState<{ packId: string; keys: Set<string> } | null>(null)
  const [bulkSuggest, setBulkSuggest] = useState<{ done: number; total: number } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImageViewerImage | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const refresh = useCallback(async () => {
    const packs = await api.emojis.listPacks({ assistant_id: null })
    const result = await Promise.all(
      packs.map(async (pack) => {
        const emojis = await api.emojis.list({ filter: { kind: 'pack', pack_id: pack.id } })
        return { pack, emojis }
      }),
    )
    setDetails(result)
    setActivePackId((current) => {
      if (current === ROOT_PATH_ID) return ROOT_PATH_ID
      if (current && result.some((item) => item.pack.id === current)) return current
      const withPending = result.find((item) => item.emojis.some((emoji) => emoji.semantic_status !== 'confirmed'))
      return (withPending ?? result[0])?.pack.id ?? ROOT_PATH_ID
    })
  }, [])

  useEffect(() => {
    refresh().then(() => setLoading(false))
  }, [refresh])

  const activeDetail = useMemo(
    () =>
      activePackId && activePackId !== ROOT_PATH_ID ? (details.find((d) => d.pack.id === activePackId) ?? null) : null,
    [details, activePackId],
  )

  const openPack = useCallback((packId: string | null) => {
    setActivePackId(packId ?? ROOT_PATH_ID)
    setInspectedId(null)
    setSelection(null)
    setStatusFilter('all')
    setSearch('')
    setPage(1)
  }, [])

  const pendingCount = useMemo(
    () => (activeDetail ? activeDetail.emojis.filter((emoji) => emoji.semantic_status !== 'confirmed').length : 0),
    [activeDetail],
  )
  const confirmedCount = activeDetail ? activeDetail.emojis.length - pendingCount : 0

  const filtered = useMemo(() => {
    if (!activeDetail) return []
    const query = search.trim().toLowerCase()
    const matches = activeDetail.emojis.filter((emoji) => {
      if (statusFilter === 'pending' && emoji.semantic_status === 'confirmed') return false
      if (statusFilter === 'confirmed' && emoji.semantic_status !== 'confirmed') return false
      if (!query) return true
      const name = shownName(emoji).toLowerCase()
      const tags = shownTags(emoji).toLowerCase()
      return name.includes(query) || tags.includes(query)
    })
    return sortEmojis(matches, sortOrder)
  }, [activeDetail, statusFilter, search, sortOrder])

  const totalPages = Math.max(1, Math.ceil(filtered.length / STICKERS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * STICKERS_PER_PAGE
    return filtered.slice(start, start + STICKERS_PER_PAGE)
  }, [filtered, currentPage])

  const packTagOptions = useMemo(() => {
    if (!activeDetail) return []
    const set = new Set<string>()
    for (const emoji of activeDetail.emojis) {
      for (const tag of parseTagList(shownTags(emoji))) set.add(tag)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [activeDetail])

  const inspectedEmoji = useMemo(
    () => (activeDetail && inspectedId ? (activeDetail.emojis.find((e) => e.id === inspectedId) ?? null) : null),
    [activeDetail, inspectedId],
  )

  const activeSelection =
    selection && activeDetail && selection.packId === activeDetail.pack.id ? selection.keys : EMPTY_SELECTION
  const selectedIds = useMemo(() => [...activeSelection], [activeSelection])
  const selectedOnPage = useMemo(
    () => pageItems.filter((emoji) => activeSelection.has(emoji.id)).length,
    [pageItems, activeSelection],
  )
  const allOnPageSelected = pageItems.length > 0 && selectedOnPage === pageItems.length
  const someOnPageSelected = selectedOnPage > 0 && selectedOnPage < pageItems.length

  const suggestableSelected = useMemo(() => {
    if (!activeDetail || selectedIds.length === 0) return []
    return activeDetail.emojis.filter(
      (emoji) => selectedIds.includes(emoji.id) && emoji.semantic_status !== 'confirmed' && emoji.file_name,
    )
  }, [activeDetail, selectedIds])

  const updateSelection = useCallback(
    (next: Set<string>) => {
      if (!activeDetail) return
      setSelection(next.size > 0 ? { packId: activeDetail.pack.id, keys: next } : null)
    },
    [activeDetail],
  )

  const toggleSelectPage = (checked: boolean) => {
    const next = new Set(activeSelection)
    if (checked) {
      for (const emoji of pageItems) next.add(emoji.id)
    } else {
      for (const emoji of pageItems) next.delete(emoji.id)
    }
    updateSelection(next)
  }

  const toggleSelectOne = useCallback(
    (id: string, checked: boolean) => {
      const next = new Set(activeSelection)
      if (checked) next.add(id)
      else next.delete(id)
      updateSelection(next)
    },
    [activeSelection, updateSelection],
  )

  const handleCreate = useCallback(async () => {
    const trimmed = newPackName.trim()
    if (!trimmed) return
    const created = await api.emojis.createPack({ name: trimmed, description: null })
    setNewPackName('')
    setCreateOpen(false)
    openPack(created.id)
    await refresh()
  }, [newPackName, openPack, refresh])

  const handleDeletePack = useCallback(
    async (id: string) => {
      if (
        !(await confirm({
          description: t('settings.confirmDelete.emojiPack'),
          confirmLabel: t('common.delete'),
          tone: 'danger',
        }))
      )
        return
      await api.emojis.deletePack({ id })
      setSelection(null)
      setInspectedId(null)
      setActivePackId(null)
      await refresh()
    },
    [confirm, t, refresh],
  )

  const handleImport = useCallback(
    async (packId: string) => {
      const files = await dialogOpen({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['gif', 'apng', 'png', 'webp', 'jpg', 'jpeg', 'bmp', 'json'] }],
      }).catch(() => null)
      if (!files) return
      const paths = Array.isArray(files) ? files : [files]
      if (paths.length === 0) return
      await api.emojis.import({ pack_id: packId, file_paths: paths })
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
      await api.emojis.delete({ id })
      forgetStickerUrl(id)
      if (inspectedId === id) setInspectedId(null)
      setSelection((current) => {
        if (!current || !current.keys.has(id)) return current
        const next = new Set(current.keys)
        next.delete(id)
        return next.size > 0 ? { packId: current.packId, keys: next } : null
      })
      await refresh()
    },
    [confirm, inspectedId, t, refresh],
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
    for (const id of selectedIds) {
      await api.emojis.delete({ id })
      forgetStickerUrl(id)
    }
    if (inspectedId && selectedIds.includes(inspectedId)) setInspectedId(null)
    setSelection(null)
    await refresh()
  }, [selectedIds, inspectedId, confirm, t, refresh])

  const handleSaveSemantics = useCallback(
    async (emoji: EmojiInfoResponse, patch: { name?: string; tags?: string }) => {
      setActionError(null)
      const name = (patch.name ?? shownName(emoji)).trim()
      if (!name) return
      const tags = (patch.tags ?? shownTags(emoji)).trim()
      try {
        await api.emojis.update({
          id: emoji.id,
          action: { kind: 'confirm_semantics', name, tags: tags || null },
        })
        await refresh()
      } catch (reason) {
        setActionError(String(reason))
      }
    },
    [refresh],
  )

  const handleSuggest = useCallback(
    async (id: string) => {
      setActionError(null)
      try {
        await api.emojis.suggestSemantics({ id })
        await refresh()
      } catch (reason) {
        setActionError(String(reason))
      }
    },
    [refresh],
  )

  const handleSuggestSelected = useCallback(async () => {
    if (suggestableSelected.length === 0 || bulkSuggest) return
    setActionError(null)
    const ids = suggestableSelected.map((emoji) => emoji.id)
    setBulkSuggest({ done: 0, total: ids.length })
    const failures: string[] = []
    for (const [index, id] of ids.entries()) {
      try {
        await api.emojis.suggestSemantics({ id })
      } catch (reason) {
        failures.push(String(reason))
      }
      setBulkSuggest({ done: index + 1, total: ids.length })
    }
    await refresh()
    setBulkSuggest(null)
    if (failures.length > 0) {
      setActionError(t('settings.emoji.suggestSelectedFailed', { count: failures.length, error: failures[0] }))
    }
  }, [suggestableSelected, bulkSuggest, refresh, t])

  const pathSegments = useMemo<PathSegment[]>(() => {
    const root: PathSegment = {
      id: ROOT_PATH_ID,
      label: t('settings.emoji.packsTitle'),
      icon: <FolderOpen size={14} />,
    }
    if (!activeDetail) return [root]
    return [root, { id: activeDetail.pack.id, label: activeDetail.pack.name, icon: <StickyNote size={14} /> }]
  }, [activeDetail, t])

  const getPathChildren = useCallback(
    (id: string): PathSegment[] => {
      if (id !== ROOT_PATH_ID) return []
      return details.map((d) => ({ id: d.pack.id, label: d.pack.name, icon: <StickyNote size={14} /> }))
    },
    [details],
  )

  const sortOptions = useMemo(
    () =>
      [
        { value: 'review', label: t('settings.emoji.sort.review') },
        { value: 'seenDesc', label: t('settings.emoji.sort.seenDesc') },
        { value: 'seenAsc', label: t('settings.emoji.sort.seenAsc') },
        { value: 'name', label: t('settings.emoji.sort.name') },
      ] as const,
    [t],
  )

  if (loading) {
    return <SettingsSkeleton width="wide" />
  }

  const canDeleteActivePack = Boolean(activeDetail && !activeDetail.pack.is_builtin)

  const notice =
    (!isRemote && showModelConfig) || actionError ? (
      <div className="m-emoji__notice-stack">
        {!isRemote && showModelConfig && (
          <div data-slot="emoji-config-grid" className="m-emoji__config-grid">
            <EmojiSuggestSettings />
            <EmojiEmbedderSettings />
          </div>
        )}
        {actionError && (
          <Alert data-slot="sticker-grid-error" tone="danger" shouldAnnounce>
            {actionError}
          </Alert>
        )}
      </div>
    ) : undefined

  const detailsPanel =
    activeDetail && inspectedEmoji ? (
      <FileDetails
        key={inspectedEmoji.id}
        heading={shownName(inspectedEmoji)}
        onOpenChange={(open) => {
          if (!open) setInspectedId(null)
        }}
        preview={
          <InspectorPreview
            emoji={inspectedEmoji}
            canDelete={canDeleteActivePack}
            onSuggest={handleSuggest}
            onConfirm={(target) => handleSaveSemantics(target, {})}
            onDelete={(id) => void handleDeleteEmoji(id)}
            onPreview={setPreview}
          />
        }
        properties={[
          {
            id: 'name',
            label: t('settings.emoji.editName'),
            type: 'text',
            value: shownName(inspectedEmoji),
          },
        ]}
        onPropertyChange={(id, value) => {
          if (id === 'name' && typeof value === 'string') {
            return handleSaveSemantics(inspectedEmoji, { name: value })
          }
        }}
        tags={parseTagList(shownTags(inspectedEmoji))}
        tagOptions={packTagOptions}
        onTagsChange={(nextTags) => void handleSaveSemantics(inspectedEmoji, { tags: nextTags.join(',') })}
        info={[
          {
            label: t('settings.emoji.statusLabel'),
            value:
              inspectedEmoji.semantic_status === 'confirmed' ? (
                <Badge tone="success">{t('settings.emoji.confirmed')}</Badge>
              ) : (
                <Badge tone="warning">{t('settings.emoji.pending')}</Badge>
              ),
          },
          {
            label: t('settings.emoji.seenColumn'),
            value: t('settings.emoji.seenCount', { count: inspectedEmoji.seen_count }),
          },
          {
            label: t('settings.emoji.formatLabel'),
            value: inspectedEmoji.file_format.toUpperCase(),
          },
          {
            label: t('settings.emoji.packLabel'),
            value: activeDetail.pack.name,
          },
        ]}
      />
    ) : undefined

  return (
    <SettingsPane width="wide" className="m-emoji__pane">
      <FileManager
        embedded
        headingLevel={2}
        heading={t('settings.emoji.title')}
        description={t('settings.emoji.subtitle')}
        notice={notice}
        page={activeDetail ? currentPage : undefined}
        totalPages={activeDetail ? totalPages : undefined}
        onPageChange={setPage}
        details={detailsPanel}
        actions={
          <>
            {!isRemote && (
              <Button
                size="sm"
                variant="secondary"
                icon={<SlidersHorizontal />}
                aria-expanded={showModelConfig}
                onPress={() => setShowModelConfig((open) => !open)}
              >
                {t('settings.emoji.modelSettings')}
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Plus />} onPress={() => setCreateOpen(true)}>
              {t('settings.emoji.newPack')}
            </Button>
            {activeDetail?.pack.kind === 'manual' && (
              <Button
                size="sm"
                icon={<Upload />}
                onPress={() => void handleImport(activeDetail.pack.id)}
                isDisabled={!can.importFromDisk}
              >
                {t('settings.emoji.import')}
              </Button>
            )}
            {canDeleteActivePack && activeDetail && (
              <Button
                size="sm"
                variant="destructive"
                icon={<Bin />}
                onPress={() => void handleDeletePack(activeDetail.pack.id)}
              >
                {t('common.delete')}
              </Button>
            )}
          </>
        }
      >
        {/* Row 1: PathBar (with pack-switcher dropdown) + review status filter */}
        <div className="m-emoji__nav-row">
          <div className="m-emoji__path">
            <PathBar
              segments={pathSegments}
              getChildren={getPathChildren}
              onNavigate={(id) => openPack(id === ROOT_PATH_ID ? null : id)}
              aria-label={t('settings.emoji.packsTitle')}
            />
          </div>
          {activeDetail && activeDetail.emojis.length > 0 && (
            <SegmentedControl
              size="sm"
              aria-label={t('settings.emoji.stickerColumn')}
              selectedKey={statusFilter}
              onSelectionChange={(key) => {
                setStatusFilter(String(key) as StatusFilter)
                setPage(1)
              }}
            >
              <Segment id="all">
                {t('settings.emoji.filter.all')} ({activeDetail.emojis.length})
              </Segment>
              <Segment id="pending">
                {t('settings.emoji.filter.pending')} ({pendingCount})
              </Segment>
              <Segment id="confirmed">
                {t('settings.emoji.filter.confirmed')} ({confirmedCount})
              </Segment>
            </SegmentedControl>
          )}
        </div>

        {!activeDetail ? (
          /* Root view: all emoji packs as clean folder tiles */
          details.length === 0 ? (
            <EmptyState heading={t('settings.emoji.noPacks')} headingLevel={3} size="sm" />
          ) : (
            <div data-slot="pack-list" className="m-emoji__folder-grid">
              {details.map((d) => {
                const pending = d.emojis.filter((emoji) => emoji.semantic_status !== 'confirmed').length
                return (
                  <AriaButton
                    key={d.pack.id}
                    data-slot="pack-item"
                    className="m-emoji__folder-card"
                    onPress={() => openPack(d.pack.id)}
                  >
                    <span className="m-emoji__folder-icon">
                      <StickyNote size={22} aria-hidden />
                    </span>
                    <span className="m-emoji__folder-meta">
                      <span onPointerEnter={titleIfTruncated} className="m-emoji__name">
                        {d.pack.name}
                      </span>
                      <span className="m-emoji__folder-sub">
                        <span>{t('settings.emoji.totalCount', { count: d.emojis.length })}</span>
                        {pending > 0 && (
                          <Badge tone="warning">{t('settings.emoji.pendingCount', { count: pending })}</Badge>
                        )}
                        {d.pack.is_builtin && <Badge>{t('settings.template.builtin')}</Badge>}
                      </span>
                    </span>
                  </AriaButton>
                )
              })}
            </div>
          )
        ) : (
          <section
            data-slot="sticker-grid"
            className="m-emoji__explorer"
            aria-label={t('settings.emoji.gridLabel', { pack: activeDetail.pack.name })}
          >
            {activeDetail.pack.description && (
              <p data-slot="pack-description" className="m-emoji__desc">
                {activeDetail.pack.description}
              </p>
            )}
            {activeDetail.pack.kind === 'manual' && !can.importFromDisk && (
              <p data-slot="pack-import-note" className="m-emoji__note">
                {t('capability.importFromDisk')}
              </p>
            )}

            {/* Row 2: Search + Sort + Select-page + Total — all on one clean horizontal baseline */}
            {activeDetail.emojis.length > 0 && (
              <div data-slot="sticker-toolbar" className="m-emoji__controls">
                <div className="m-emoji__controls-start">
                  <SearchField
                    size="sm"
                    aria-label={t('settings.emoji.searchPlaceholder')}
                    placeholder={t('settings.emoji.searchPlaceholder')}
                    value={search}
                    onChange={(value) => {
                      setSearch(value)
                      setPage(1)
                    }}
                    className="m-emoji__search"
                  />
                  <div className="m-emoji__sort">
                    <SettingsSelect
                      size="sm"
                      ariaLabel={t('settings.emoji.sortLabel')}
                      value={sortOrder}
                      options={sortOptions}
                      onChange={(next) => {
                        setSortOrder(next)
                        setPage(1)
                      }}
                    />
                  </div>
                </div>

                <div className="m-emoji__controls-end">
                  <span className="m-emoji__count">{t('settings.emoji.totalCount', { count: filtered.length })}</span>
                  {canDeleteActivePack && pageItems.length > 0 && (
                    <Checkbox
                      isSelected={allOnPageSelected}
                      isIndeterminate={someOnPageSelected}
                      onChange={toggleSelectPage}
                    >
                      {t('settings.emoji.selectPage')}
                    </Checkbox>
                  )}
                </div>
              </div>
            )}

            {activeDetail.emojis.length === 0 ? (
              <EmptyState heading={t('settings.emoji.noStickers')} headingLevel={4} size="sm" />
            ) : filtered.length === 0 ? (
              <EmptyState heading={t('settings.emoji.noMatches')} headingLevel={4} size="sm" />
            ) : (
              <div data-slot="sticker-cards" className="m-emoji__cards">
                {pageItems.map((emoji) => (
                  <StickerTile
                    key={emoji.id}
                    emoji={emoji}
                    canDelete={canDeleteActivePack}
                    selected={activeSelection.has(emoji.id)}
                    inspected={inspectedId === emoji.id}
                    onToggleSelected={(checked) => toggleSelectOne(emoji.id, checked)}
                    onInspect={() => setInspectedId(emoji.id)}
                    onSave={handleSaveSemantics}
                    onSuggest={handleSuggest}
                    onDelete={(id) => void handleDeleteEmoji(id)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </FileManager>

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
          onPress={() => void handleDeleteSelected()}
          isDisabled={bulkSuggest !== null}
        >
          {t('settings.emoji.deleteSelected')}
        </Button>
      </SelectionBar>

      <Dialog
        isOpen={createOpen}
        size="sm"
        heading={t('settings.emoji.newPack')}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setNewPackName('')
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreate()
          }}
        >
          <TextField
            label={t('settings.emoji.packName')}
            value={newPackName}
            onChange={setNewPackName}
            placeholder={t('settings.emoji.packName')}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onPress={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" isDisabled={!newPackName.trim()}>
              {t('settings.emoji.newPack')}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <ImageViewer
        isOpen={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        images={preview ? [preview] : []}
      />
      {confirmDialog}
    </SettingsPane>
  )
}
