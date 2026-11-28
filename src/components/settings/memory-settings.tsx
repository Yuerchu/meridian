import './memory-settings.css'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, Plus } from '@keyline-icons/react/two-tone'
import { api } from '@/api'
import type { MemoryType } from '@/types'
import { DisclosureGroup } from 'react-aria-components'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { SelectionBar } from '@/components/yuerchu-ui/components/selection-bar/selection-bar'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { useConfirm } from '@/hooks/use-confirm'
import { DreamPanel } from './memory/dream-panel'
import { MemoryRow } from './memory/memory-row'
import { MemoryTrash } from './memory/memory-trash'
import { ScopeNav } from './memory/scope-nav'
import { useMemoryBrowser } from './memory/use-memory-browser'
import { memoryOriginLabel, memoryTypeLabel } from './memory/labels'
import { SettingsHeader, SettingsSelect, SettingsSkeleton } from './primitives'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'

export function MemorySettings() {
  const { t } = useTranslation()
  const browser = useMemoryBrowser()
  const [trashOpen, setTrashOpen] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<MemoryType>('general')
  const [actionError, setActionError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const typeOptions = (browser.enums?.memory_types ?? ['general']).map((v) => ({
    value: v,
    label: memoryTypeLabel(t, v),
  }))
  const originOptions = [
    { value: 'all', label: t('settings.memory.learnedIn.all') },
    ...(browser.enums?.origins ?? []).map((v) => ({ value: v, label: memoryOriginLabel(t, v) })),
  ]

  // Writable from here: a project, or the client-wide layer when that branch is
  // selected. The per-person and bot-wide layers are populated by conversations
  // and by operator approval instead.
  const targetScope = browser.filter.kind === 'clientGlobal' ? 'client_global' : 'project'
  const targetProjectId = browser.filter.kind === 'project' ? browser.filter.projectId : browser.projects[0]?.id
  // The client-wide layer needs no project, so it stays available to someone who
  // has not created one.
  const canAdd = targetScope === 'client_global' || !!targetProjectId

  const handleAdd = async () => {
    if (!canAdd || !newKey.trim() || !newContent.trim()) return
    setActionError(null)
    try {
      await api.memories.create({
        scope: targetScope,
        project_id: targetScope === 'project' ? (targetProjectId ?? null) : null,
        subject_scope_id: null,
        key: newKey.trim(),
        content: newContent.trim(),
        memory_type: newType,
        owner_only: false,
      })
    } catch (reason) {
      setActionError(String(reason))
      return
    }
    setNewKey('')
    setNewContent('')
    setShowAdd(false)
    browser.refresh()
  }

  return (
    // Its own `pane` container: this panel does not go through `SettingsPane`,
    // so without one the two-column rule below would find no container at all
    // and silently never match. For the same reason it carries the settings
    // width itself — it was the one page left full-width when every page
    // moved to one; e2e/settings-width.spec.ts is what now notices.
    <div data-slot="memory-settings" className="m-memory-settings">
      <SettingsHeader
        title={t('settings.memory.title')}
        subtitle={t('settings.memory.subtitle')}
        actions={
          // The page's own actions, small, the creating one primary
          // (settings-general.tsx / settings-tools.tsx header buttons): the
          // trash is somewhere to look, a new memory is the thing to do.
          <>
            <Button
              size="sm"
              variant="secondary"
              icon={<Bin />}
              onPress={() => setTrashOpen(true)}
              data-slot="memory-trash-open"
            >
              {t('settings.memory.trash.title')}
            </Button>
            <Button
              size="sm"
              icon={<Plus />}
              onPress={() => setShowAdd(true)}
              isDisabled={!canAdd}
              data-slot="memory-new"
            >
              {t('settings.memory.new')}
            </Button>
          </>
        }
      />

      {/* Stacked until this panel — not the window — can hold two columns.
          224px of nav, 16px of gap and 320px for the list itself. Must stay on
          the same stop as `ScopeNav`'s own width rule: keyed differently, one of
          them flips first and the layout gets a 224px column lying
          across it. */}
      <div data-slot="memory-layout" className="m-memory-settings__layout">
        <ScopeNav
          filter={browser.filter}
          onFilterChange={browser.setFilter}
          counts={browser.counts}
          projects={browser.projects}
          subjects={browser.subjects}
          onChanged={browser.refresh}
        />

        <div data-slot="memory-list" className="m-memory-settings__list">
          <DreamPanel
            targetScope={targetScope}
            targetScopeId={targetScope === 'project' ? (targetProjectId ?? '_') : '_'}
            onMemoriesChanged={browser.refresh}
          />
          <div data-slot="memory-toolbar" className="m-memory-settings__toolbar">
            <TextField
              aria-label={t('settings.memory.search')}
              name="memorySearch"
              value={browser.search}
              onChange={(e) => browser.setSearch(e)}
              placeholder={t('settings.memory.search')}
              className="m-memory-settings__search"
            />
            <SettingsSelect
              ariaLabel={t('settings.memory.originFilter')}
              value={browser.originFilter}
              options={originOptions}
              onChange={browser.setOriginFilter}
            />
          </div>

          {actionError && (
            <Alert data-slot="memory-action-error" tone="danger" shouldAnnounce>
              {actionError}
            </Alert>
          )}

          {/* A draft memory is a card of rows like any other settings form
              (settings-profile.tsx): each field named on its own row, and the
              two ways out as words rather than a pair of unlabelled glyphs. */}
          {showAdd && (
            <SettingsGroup>
              <SettingsRow label={t('settings.memory.key')}>
                <TextField
                  name="memoryKey"
                  value={newKey}
                  onChange={(e) => setNewKey(e)}
                  spellCheck="false"

                  autoFocus
                />
              </SettingsRow>
              <SettingsRow label={t('settings.memory.type')}>
                <SettingsSelect
                  ariaLabel={t('settings.memory.type')}
                  value={newType}
                  options={typeOptions}
                  onChange={setNewType}
                />
              </SettingsRow>
              <SettingsRow label={t('settings.memory.content')}>
                <TextArea
                  name="memoryContent"
                  value={newContent}
                  onChange={(e) => setNewContent(e)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      void handleAdd()
                    }
                  }}
                  rows={3}
                />
              </SettingsRow>
              <div data-slot="memory-add-actions" className="m-memory-settings__add-actions">
                <Button size="sm" variant="secondary" onPress={() => setShowAdd(false)}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" onPress={() => void handleAdd()} isDisabled={!newKey.trim() || !newContent.trim()}>
                  {t('settings.memory.add')}
                </Button>
              </div>
            </SettingsGroup>
          )}

          {browser.loading ? (
            <SettingsSkeleton rows={3} width="wide" />
          ) : browser.error ? (
            <Alert
              shouldAnnounce
              tone="danger"
              actions={
                <Button size="sm" variant="secondary" onPress={() => void browser.refresh()}>
                  {t('settings.memory.retry')}
                </Button>
              }
            >
              {t('settings.memory.loadError')}
            </Alert>
          ) : browser.visible.length === 0 && !showAdd ? (
            <EmptyState heading={t('settings.memory.empty')} headingLevel={3} size="sm" />
          ) : null}

          {/* One open at a time is the group's own default
              (`allowsMultipleExpanded` is off), so the single-open rule lives
              in the primitive rather than in a hand-held `expandedId`. Which is
              also why the group is mounted unconditionally: its expanded key is
              uncontrolled state, so gating it on a non-empty list would forget
              which row was open every time a search matched nothing. Empty, it
              is hidden rather than unmounted, for the same reason. */}
          <DisclosureGroup
            data-slot="memory-rows"
            // One surface with rows dividing themselves. Empty, an unhidden
            // card would be a stripe with nothing in it.
            className="m-memory-settings__rows"
            hidden={browser.visible.length === 0}
            aria-busy={browser.loading}
          >
            {browser.visible.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                checked={browser.selected.has(m.id)}
                onToggleCheck={() => browser.toggleSelected(m.id)}
                onChanged={browser.refresh}
              />
            ))}
          </DisclosureGroup>

          {/* The library's bulk bar: it keeps its own height in the flow, so it
              needs no portal out of this query container, and it announces the
              count and returns focus to the list when it closes. */}
          <SelectionBar selectedCount={browser.selected.size} onClear={browser.clearSelection}>
            <Button
              size="sm"
              variant="secondary"
              onPress={browser.selectAllVisible}
              isDisabled={browser.selected.size === browser.visible.length}
            >
              {t('settings.memory.selectAll')}
            </Button>
            <Button
              size="sm"
              icon={<Bin />}
              variant="destructive"
              onPress={async () => {
                const ok = await confirm({
                  heading: t('settings.memory.deleteConfirmTitle'),
                  description: t('settings.memory.deleteConfirmBody'),
                  confirmLabel: t('common.delete'),
                  tone: 'danger',
                })
                if (!ok) return
                setActionError(null)
                try {
                  await api.memories.delete({ ids: [...browser.selected], permanent: false })
                } catch (reason) {
                  setActionError(String(reason))
                  return
                }
                browser.clearSelection()
                browser.refresh()
              }}
            >
              {t('settings.memory.deleteSelected')}
            </Button>
          </SelectionBar>
        </div>
      </div>

      <MemoryTrash open={trashOpen} onOpenChange={setTrashOpen} onChanged={browser.refresh} />
      {confirmDialog}
    </div>
  )
}
