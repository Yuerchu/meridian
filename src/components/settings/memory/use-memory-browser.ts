import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/api'
import type { Memory, MemoryEnums, MemorySubject, Project } from '@/types'

/** Which branch of the left-hand filter is selected.
 *
 *  `clientGlobal` and `global` are siblings, not nested: one is what the user
 *  told Meridian directly, the other is the bot side. Neither is injected into
 *  the other's conversations. */
export type ScopeFilter =
  | { kind: 'all' }
  | { kind: 'clientGlobal' }
  | { kind: 'global' }
  | { kind: 'chats' }
  | { kind: 'project'; projectId: string }
  | { kind: 'people' }
  | { kind: 'person'; scopeId: string }

export function useMemoryBrowser() {
  const [projects, setProjects] = useState<Project[]>([])
  const [subjects, setSubjects] = useState<MemorySubject[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [enums, setEnums] = useState<MemoryEnums | null>(null)
  const [filter, setFilter] = useState<ScopeFilter>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const [originFilter, setOriginFilter] = useState<string>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  // Enum values come from Rust so the front end never keeps its own copy to
  // drift out of sync.
  useEffect(() => {
    api.memoryEnums().then(setEnums).catch(() => {})
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      // One query covering every scope. Fanning out per project cost an IPC
      // round trip each and, worse, could only ever return project rows — the
      // bot-wide and per-person branches below would have stayed empty forever.
      const [projectList, subjectList, allMemories] = await Promise.all([
        api.listProjects(),
        api.listMemorySubjects(),
        api.listAllMemories(),
      ])
      setProjects(projectList)
      setSubjects(subjectList)
      setMemories(allMemories)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const visible = useMemo(() => {
    let rows = memories
    switch (filter.kind) {
      case 'clientGlobal':
        rows = rows.filter((m) => m.scope_type === 'client_global')
        break
      case 'global':
        rows = rows.filter((m) => m.scope_type === 'onebot_global')
        break
      case 'chats':
        rows = rows.filter((m) => m.scope_type === 'project')
        break
      case 'project':
        rows = rows.filter((m) => m.scope_id === filter.projectId)
        break
      case 'people':
        rows = rows.filter((m) => m.scope_type === 'onebot_user')
        break
      case 'person':
        rows = rows.filter((m) => m.scope_id === filter.scopeId)
        break
      default:
        break
    }
    if (originFilter !== 'all') {
      rows = rows.filter((m) => m.origin === originFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (m) => m.key.toLowerCase().includes(q) || m.content.toLowerCase().includes(q),
      )
    }
    return rows
  }, [memories, filter, originFilter, search])

  const counts = useMemo(
    () => ({
      all: memories.length,
      clientGlobal: memories.filter((m) => m.scope_type === 'client_global').length,
      global: memories.filter((m) => m.scope_type === 'onebot_global').length,
      chats: memories.filter((m) => m.scope_type === 'project').length,
      people: memories.filter((m) => m.scope_type === 'onebot_user').length,
    }),
    [memories],
  )

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  /** Everything the current filter and search leave on screen — not every
   *  memory in the database, which is not what the row checkboxes offered. */
  const selectAllVisible = useCallback(
    () => setSelected(new Set(visible.map((m) => m.id))),
    [visible],
  )

  return {
    projects,
    subjects,
    enums,
    filter,
    setFilter,
    search,
    setSearch,
    originFilter,
    setOriginFilter,
    visible,
    counts,
    selected,
    toggleSelected,
    clearSelection,
    selectAllVisible,
    loading,
    refresh,
  }
}
