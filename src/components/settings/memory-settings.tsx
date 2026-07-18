import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Memory, Project } from '@/types'

const MEMORY_TYPES = ['general', 'preference', 'fact', 'instruction'] as const

const MEMORY_TYPE_OPTIONS = MEMORY_TYPES.map((mt) => ({ value: mt, label: mt }))

export function MemorySettings() {
  const { t } = useTranslation()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [memories, setMemories] = useState<Memory[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editType, setEditType] = useState('general')
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState('general')

  useEffect(() => {
    api.listProjects().then(setProjects)
  }, [])

  const loadMemories = useCallback(async () => {
    if (!selectedProjectId) {
      setMemories([])
      return
    }
    const list = await api.listMemories(selectedProjectId)
    setMemories(list)
  }, [selectedProjectId])

  useEffect(() => { loadMemories() }, [loadMemories])

  const handleAdd = async () => {
    if (!selectedProjectId || !newKey.trim() || !newContent.trim()) return
    await api.saveMemory(selectedProjectId, newKey.trim(), newContent.trim(), newType)
    setNewKey('')
    setNewContent('')
    setNewType('general')
    setShowAdd(false)
    loadMemories()
  }

  const handleSaveEdit = async (id: string) => {
    await api.updateMemory(id, editContent, editType)
    setEditingId(null)
    loadMemories()
  }

  const handleDelete = async (id: string) => {
    await api.deleteMemory(id)
    loadMemories()
  }

  const startEdit = (m: Memory) => {
    setEditingId(m.id)
    setEditContent(m.content)
    setEditType(m.memory_type)
  }

  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }))

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">{t('settings.memory.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('settings.memory.subtitle')}</p>
      </div>

      <div>
        <label className="text-sm font-medium">{t('settings.memory.selectProject')}</label>
        <Select value={selectedProjectId ?? ''} onValueChange={(v) => setSelectedProjectId(v || null)} items={projectOptions}>
          <SelectTrigger className="mt-1 w-full">
            <SelectValue placeholder={t('settings.memory.selectProject')} />
          </SelectTrigger>
          <SelectContent>
            {projectOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedProjectId && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
              <Plus />
              {t('settings.memory.add')}
            </Button>
          </div>

          {showAdd && (
            <div className="p-3 border border-border rounded-md space-y-2 bg-muted/30">
              <Input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={t('settings.memory.key')}
                autoFocus
              />
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t('settings.memory.content')}
                rows={3}
                className="resize-y"
              />
              <div className="flex items-center gap-2">
                <Select value={newType} onValueChange={(v) => { if (v) setNewType(v) }} items={MEMORY_TYPE_OPTIONS}>
                  <SelectTrigger className="w-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMORY_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex-1" />
                <Button variant="ghost" size="icon-xs" onClick={() => setShowAdd(false)}>
                  <X />
                </Button>
                <Button
                  variant="secondary"
                  size="icon-xs"
                  onClick={handleAdd}
                  disabled={!newKey.trim() || !newContent.trim()}
                >
                  <Check />
                </Button>
              </div>
            </div>
          )}

          {memories.length === 0 && !showAdd && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t('settings.memory.noMemories')}
            </p>
          )}

          {memories.map((m) => (
            <div key={m.id} className="p-3 border border-border rounded-md space-y-1.5">
              {editingId === m.id ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">{m.key}</div>
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="resize-y"
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <Select value={editType} onValueChange={(v) => { if (v) setEditType(v) }} items={MEMORY_TYPE_OPTIONS}>
                      <SelectTrigger className="w-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MEMORY_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex-1" />
                    <Button variant="ghost" size="icon-xs" onClick={() => setEditingId(null)}>
                      <X />
                    </Button>
                    <Button variant="secondary" size="icon-xs" onClick={() => handleSaveEdit(m.id)}>
                      <Check />
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{m.key}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{m.memory_type}</span>
                    <div className="flex-1" />
                    <Button variant="ghost" size="icon-xs" onClick={() => startEdit(m)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(m.id)}>
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{m.content}</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
