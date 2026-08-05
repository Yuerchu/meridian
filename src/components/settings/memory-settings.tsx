import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash, X, Check } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input, ListBox, Select, TextArea } from '@heroui/react'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { MemoryRow } from './memory/memory-row'
import { MemoryTrash } from './memory/memory-trash'
import { ScopeNav } from './memory/scope-nav'
import { useMemoryBrowser } from './memory/use-memory-browser'

export function MemorySettings() {
  const { t } = useTranslation()
  const browser = useMemoryBrowser()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState('general')

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
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('settings.memory.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('settings.memory.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setTrashOpen(true)} data-slot="memory-trash-open">
            <Trash />
            {t('settings.memory.trash.title')}
          </Button>
          <Button variant="secondary" onClick={() => setShowAdd(true)} disabled={!canAdd}>
            <Plus />
            {t('settings.memory.new')}
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
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
            <div className="space-y-2 rounded-lg border border-border bg-default/30 p-3">
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
                <Button variant="ghost" size="icon" onClick={() => setShowAdd(false)}>
                  <X />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleAdd}
                  disabled={!newKey.trim() || !newContent.trim()}
                >
                  <Check />
                </Button>
              </div>
            </div>
          )}

          {browser.visible.length === 0 && !showAdd && (
            <p className="py-6 text-center text-sm text-muted">
              {t('settings.memory.empty')}
            </p>
          )}

          {browser.visible.map((m) => (
            <MemoryRow
              key={m.id}
              memory={m}
              expanded={expandedId === m.id}
              onToggleExpand={() => setExpandedId(expandedId === m.id ? null : m.id)}
              checked={browser.selected.has(m.id)}
              onToggleCheck={() => browser.toggleSelected(m.id)}
              onChanged={browser.refresh}
            />
          ))}

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
              <Button variant="ghost" onClick={() => setConfirmBulk(true)}>
                <Trash className="text-danger" />
                {t('settings.memory.deleteSelected')}
              </Button>
              <AlertDialog
                open={confirmBulk}
                onOpenChange={(open) => { if (!open) setConfirmBulk(false) }}
              >
                <AlertDialogPopup>
                  <AlertDialogTitle>{t('settings.memory.deleteConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('settings.memory.deleteConfirmBody')}
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogClose className="bg-default text-default-foreground hover:bg-default/80">
                      {t('common.cancel')}
                    </AlertDialogClose>
                    <AlertDialogClose
                      className="bg-danger text-white hover:bg-danger/80"
                      onClick={async () => {
                        await api.deleteMemories([...browser.selected])
                        browser.clearSelection()
                        browser.refresh()
                      }}
                    >
                      {t('common.confirm')}
                    </AlertDialogClose>
                  </AlertDialogFooter>
                </AlertDialogPopup>
              </AlertDialog>
            </div>
          )}
        </div>
      </div>

      <MemoryTrash open={trashOpen} onOpenChange={setTrashOpen} onChanged={browser.refresh} />
    </div>
  )
}
