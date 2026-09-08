import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Plus, TrashBin, Xmark, Check } from '@gravity-ui/icons'
import { api } from '@/api'
import type { MemoryType } from '@/types'
import { Alert, Button, Card, DisclosureGroup, Input, Label, TextArea, TextField, Tooltip } from '@heroui/react'
import { EmptyState } from '@heroui-pro/react/empty-state'
import { ActionBar } from '@heroui-pro/react/action-bar'
import { useConfirm } from '@/hooks/use-confirm'
import { MemoryRow } from './memory/memory-row'
import { MemoryTrash } from './memory/memory-trash'
import { ScopeNav } from './memory/scope-nav'
import { useMemoryBrowser } from './memory/use-memory-browser'
import { SettingsHeader, SettingsSelect, SettingsSkeleton } from './primitives'

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
    label: v,
  }))
  const originOptions = [
    { value: 'all', label: t('settings.memory.learnedIn.all') },
    ...(browser.enums?.origins ?? []).map((v) => ({ value: v, label: v })),
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
      await api.saveMemoryScoped({
        scope: targetScope,
        projectId: targetScope === 'project' ? targetProjectId : null,
        subjectScopeId: null,
        key: newKey.trim(),
        content: newContent.trim(),
        memoryType: newType,
        ownerOnly: false,
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
    // and silently never match.
    <div data-slot="memory-settings" className="@container/pane space-y-4">
      <SettingsHeader
        title={t('settings.memory.title')}
        subtitle={t('settings.memory.subtitle')}
        actions={
          <>
            <Button variant="ghost" onPress={() => setTrashOpen(true)} data-slot="memory-trash-open">
              <TrashBin />
              {t('settings.memory.trash.title')}
            </Button>
            <Button variant="secondary" onPress={() => setShowAdd(true)} isDisabled={!canAdd}>
              <Plus />
              {t('settings.memory.new')}
            </Button>
          </>
        }
      />

      {/* Stacked until this panel — not the window — can hold two columns.
          224px of nav, 16px of gap and 320px for the list itself. Must stay on
          the same stop as `ScopeNav`'s own width rule: keyed differently, one of
          them flips first and the stacked layout gets a 224px column lying
          across it. */}
      <div data-slot="memory-layout" className="flex flex-col gap-4 @xl/pane:flex-row">
        <ScopeNav
          filter={browser.filter}
          onFilterChange={browser.setFilter}
          counts={browser.counts}
          projects={browser.projects}
          subjects={browser.subjects}
          onChanged={browser.refresh}
        />

        <div data-slot="memory-list" className="min-w-0 flex-1 space-y-2">
          <div data-slot="memory-toolbar" className="flex items-center gap-2">
            <Input
              fullWidth
              type="text"
              aria-label={t('settings.memory.search')}
              name="memorySearch"
              value={browser.search}
              onChange={(e) => browser.setSearch(e.target.value)}
              placeholder={t('settings.memory.search')}
              className="flex-1"
            />
            <SettingsSelect
              ariaLabel={t('settings.memory.originFilter')}
              value={browser.originFilter}
              options={originOptions}
              onChange={browser.setOriginFilter}
              triggerClassName="w-auto"
            />
          </div>

          {actionError && (
            <p data-slot="memory-action-error" role="alert" className="text-xs text-danger break-all">
              {actionError}
            </p>
          )}

          {showAdd && (
            <Card data-slot="memory-add-form">
              <TextField fullWidth>
                <Label>{t('settings.memory.key')}</Label>
                <Input
                  type="text"
                  name="memoryKey"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  autoFocus
                />
              </TextField>
              <TextField fullWidth>
                <Label>{t('settings.memory.content')}</Label>
                <TextArea
                  name="memoryContent"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      void handleAdd()
                    }
                  }}
                  rows={3}
                  className="resize-y"
                />
              </TextField>
              <div data-slot="memory-add-actions" className="flex items-center gap-2">
                <SettingsSelect
                  ariaLabel={t('settings.memory.type')}
                  value={newType}
                  options={typeOptions}
                  onChange={setNewType}
                  triggerClassName="w-auto"
                />
                <div data-slot="memory-add-spacer" className="flex-1" />
                <Tooltip delay={0}>
                  <Button variant="ghost" isIconOnly aria-label={t('common.cancel')} onPress={() => setShowAdd(false)}>
                    <Xmark />
                  </Button>
                  <Tooltip.Content>{t('common.cancel')}</Tooltip.Content>
                </Tooltip>
                <Tooltip delay={0}>
                  <Button
                    variant="secondary"
                    isIconOnly
                    aria-label={t('settings.memory.add')}
                    onPress={handleAdd}
                    isDisabled={!newKey.trim() || !newContent.trim()}
                  >
                    <Check />
                  </Button>
                  <Tooltip.Content>{t('settings.memory.add')}</Tooltip.Content>
                </Tooltip>
              </div>
            </Card>
          )}

          {browser.loading ? (
            <SettingsSkeleton rows={3} />
          ) : browser.error ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description className="break-words">{t('settings.memory.loadError')}</Alert.Description>
                <Button size="sm" variant="outline" className="mt-2" onPress={() => void browser.refresh()}>
                  {t('settings.memory.retry')}
                </Button>
              </Alert.Content>
            </Alert>
          ) : browser.visible.length === 0 && !showAdd ? (
            <EmptyState size="sm">
              <EmptyState.Header>
                <EmptyState.Title>{t('settings.memory.empty')}</EmptyState.Title>
              </EmptyState.Header>
            </EmptyState>
          ) : null}

          {/* One open at a time is the group's own default
              (`allowsMultipleExpanded` is off), so the single-open rule lives
              in the primitive rather than in a hand-held `expandedId`. Which is
              also why the group is mounted unconditionally: its expanded key is
              uncontrolled state, so gating it on a non-empty list would forget
              which row was open every time a search matched nothing. Empty, it
              renders a bare `w-full` div with no children for `gap-2` to space —
              nothing shows. */}
          <DisclosureGroup data-slot="memory-rows" className="flex flex-col gap-2" aria-busy={browser.loading}>
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

          {/* Fixed to the bottom of the viewport rather than appended below the
              list, which is where it used to be — on a long list you had to
              scroll to the end to reach the actions for rows at the top.

              Through a portal, because Pro renders `.action-bar` in place and it
              is `position: fixed`. This panel is a query container now, and
              `container-type` brings `contain: layout` with it — which makes the
              container the containing block for its fixed descendants. Left
              here, the bar would drop out of the viewport and into the panel,
              scrolling with the list it exists to stay clear of. */}
          {createPortal(
            <ActionBar data-slot="memory-bulk-bar" isOpen={browser.selected.size > 0}>
              <ActionBar.Prefix>
                {/* The count is the only thing that says a selection exists, so
                  it announces itself rather than only appearing. */}
                <span data-slot="memory-selected-count" aria-live="polite" className="text-sm text-muted">
                  {t('settings.memory.selectedCount', { count: browser.selected.size })}
                </span>
              </ActionBar.Prefix>
              <ActionBar.Content>
                <Button
                  variant="ghost"
                  onPress={browser.selectAllVisible}
                  isDisabled={browser.selected.size === browser.visible.length}
                >
                  {t('settings.memory.selectAll')}
                </Button>
                <Button
                  variant="ghost"
                  onPress={async () => {
                    const ok = await confirm({
                      title: t('settings.memory.deleteConfirmTitle'),
                      body: t('settings.memory.deleteConfirmBody'),
                    })
                    if (!ok) return
                    setActionError(null)
                    try {
                      await api.deleteMemories([...browser.selected])
                    } catch (reason) {
                      setActionError(String(reason))
                      return
                    }
                    browser.clearSelection()
                    browser.refresh()
                  }}
                >
                  <TrashBin className="text-danger" />
                  {t('settings.memory.deleteSelected')}
                </Button>
              </ActionBar.Content>
              <ActionBar.Suffix>
                <Tooltip delay={0}>
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label={t('settings.memory.clearSelection')}
                    onPress={browser.clearSelection}
                  >
                    <Xmark />
                  </Button>
                  <Tooltip.Content>{t('settings.memory.clearSelection')}</Tooltip.Content>
                </Tooltip>
              </ActionBar.Suffix>
            </ActionBar>,
            document.body,
          )}
        </div>
      </div>

      <MemoryTrash open={trashOpen} onOpenChange={setTrashOpen} onChanged={browser.refresh} />
      {confirmDialog}
    </div>
  )
}
