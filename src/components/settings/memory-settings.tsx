import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import { api } from '@/api'
import type { Memory, Project } from '@/types'

const MEMORY_TYPES = ['general', 'preference', 'fact', 'instruction'] as const

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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">{t('settings.memory.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('settings.memory.subtitle')}</p>
      </div>

      <div>
        <label className="text-sm font-medium">{t('settings.memory.selectProject')}</label>
        <select
          value={selectedProjectId ?? ''}
          onChange={(e) => setSelectedProjectId(e.target.value || null)}
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">{t('settings.memory.selectProject')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {selectedProjectId && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
            </span>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-accent-foreground rounded-md hover:bg-accent/80"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('settings.memory.add')}
            </button>
          </div>

          {showAdd && (
            <div className="p-3 border border-border rounded-md space-y-2 bg-muted/30">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={t('settings.memory.key')}
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t('settings.memory.content')}
                rows={3}
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              />
              <div className="flex items-center gap-2">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {MEMORY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <div className="flex-1" />
                <button
                  onClick={() => setShowAdd(false)}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!newKey.trim() || !newContent.trim()}
                  className="p-1.5 text-accent-foreground bg-accent rounded hover:bg-accent/80 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                </button>
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
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={editType}
                      onChange={(e) => setEditType(e.target.value)}
                      className="px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {MEMORY_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <div className="flex-1" />
                    <button onClick={() => setEditingId(null)} className="p-1.5 text-muted-foreground hover:text-foreground rounded">
                      <X className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleSaveEdit(m.id)} className="p-1.5 text-accent-foreground bg-accent rounded hover:bg-accent/80">
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{m.key}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{m.memory_type}</span>
                    <div className="flex-1" />
                    <button onClick={() => startEdit(m)} className="p-1 text-muted-foreground hover:text-foreground rounded">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(m.id)} className="p-1 text-muted-foreground hover:text-destructive rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
