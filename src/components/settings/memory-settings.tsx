import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, TrashBin, Xmark, Check } from '@gravity-ui/icons'
import { api } from '@/api'
import { Button, Card, DisclosureGroup, Input, ListBox, Select, TextArea } from '@heroui/react'
import { useConfirm } from '@/hooks/use-confirm'
import { MemoryRow } from './memory/memory-row'
import { MemoryTrash } from './memory/memory-trash'
import { ScopeNav } from './memory/scope-nav'
import { useMemoryBrowser } from './memory/use-memory-browser'
import { SettingsHeader } from './primitives'

export function MemorySettings() {
  const { t } = useTranslation()
  const browser = useMemoryBrowser()
  const [trashOpen, setTrashOpen] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState('general')
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
  const targetProjectId =
    browser.filter.kind === 'project' ? browser.filter.projectId : browser.projects[0]?.id
  // The client-wide layer needs no project, so it stays available to someone who
  // has not created one.
  const canAdd = targetScope === 'client_global' || !!targetProjectId

  const handleAdd = async () => {
    if (!canAdd || !newKey.trim() || !newContent.trim()) return
    await api.saveMemoryScoped({
      scope: targetScope,
      projectId: targetScope === 'project' ? targetProjectId : null,
      key: newKey.trim(),
      content: newContent.trim(),
      memoryType: newType,
    })
    setNewKey('')
    setNewContent('')
    setShowAdd(false)
    browser.refresh()
  }

  return (
    <div data-slot="memory-settings" className="space-y-4">
      <SettingsHeader
        title={t('settings.memory.title')}
        subtitle={t('settings.memory.subtitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setTrashOpen(true)} data-slot="memory-trash-open">
              <TrashBin />
              {t('settings.memory.trash.title')}
            </Button>
            <Button variant="secondary" onClick={() => setShowAdd(true)} isDisabled={!canAdd}>
              <Plus />
              {t('settings.memory.new')}
            </Button>
          </>
        }
      />

      {/* Stacked until the viewport can hold two columns. */}
      <div className="flex flex-col gap-4 md:flex-row">
        <ScopeNav
          filter={browser.filter}
          onFilterChange={browser.setFilter}
          counts={browser.counts}
          projects={browser.projects}
          subjects={browser.subjects}
          onChanged={browser.refresh}
        />

        <div data-slot="memory-list" className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Input fullWidth
              type="text"
              value={browser.search}
              onChange={(e) => browser.setSearch(e.target.value)}
              placeholder={t('settings.memory.search')}
              className="flex-1"
            />
            <Select
              value={browser.originFilter}
              onChange={(v) => { if (v) browser.setOriginFilter(String(v)) }}
            >
              <Select.Trigger className="w-auto">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {originOptions.map((o) => (
                    <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                      {o.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          {showAdd && (
            <Card data-slot="memory-add-form">
              <Input fullWidth
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={t('settings.memory.key')}
                autoFocus
              />
              <TextArea fullWidth
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t('settings.memory.content')}
                rows={3}
                className="resize-y"
              />
              <div className="flex items-center gap-2">
                <Select
                  value={newType}
                  onChange={(v) => { if (v) setNewType(String(v)) }}
                >
                  <Select.Trigger className="w-auto">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {typeOptions.map((o) => (
                        <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                          {o.label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <div className="flex-1" />
                <Button variant="ghost" isIconOnly onClick={() => setShowAdd(false)}>
                  <Xmark />
                </Button>
                <Button
                  variant="secondary"
                  isIconOnly
                  onClick={handleAdd}
                  isDisabled={!newKey.trim() || !newContent.trim()}
                >
                  <Check />
                </Button>
              </div>
            </Card>
          )}

          {browser.visible.length === 0 && !showAdd && (
            <p className="py-6 text-center text-sm text-muted">
              {t('settings.memory.empty')}
            </p>
          )}

          {/* One open at a time is the group's own default
              (`allowsMultipleExpanded` is off), so the single-open rule lives
              in the primitive rather than in a hand-held `expandedId`. Which is
              also why the group is mounted unconditionally: its expanded key is
              uncontrolled state, so gating it on a non-empty list would forget
              which row was open every time a search matched nothing. Empty, it
              renders a bare `w-full` div with no children for `gap-2` to space —
              nothing shows. */}
          <DisclosureGroup data-slot="memory-rows" className="flex flex-col gap-2">
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

          {browser.selected.size > 0 && (
            <div
              data-slot="memory-bulk-bar"
              className="flex items-center gap-2 rounded-lg border border-border bg-default/30 p-3"
            >
              <span className="text-sm text-muted">
                {t('settings.memory.selectedCount', { count: browser.selected.size })}
              </span>
              <div className="flex-1" />
              <Button variant="ghost" onClick={browser.clearSelection}>
                {t('settings.memory.clearSelection')}
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm({
                    title: t('settings.memory.deleteConfirmTitle'),
                    body: t('settings.memory.deleteConfirmBody'),
                  })
                  if (!ok) return
                  await api.deleteMemories([...browser.selected])
                  browser.clearSelection()
                  browser.refresh()
                }}
              >
                <TrashBin className="text-danger" />
                {t('settings.memory.deleteSelected')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <MemoryTrash open={trashOpen} onOpenChange={setTrashOpen} onChanged={browser.refresh} />
      {confirmDialog}
    </div>
  )
}
