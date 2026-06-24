import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
import SettingsPage from '@/components/settings'
import { api } from '@/api'
import type { Conversation, Project } from '@/types'

type Page = 'chat' | 'settings'

function App() {
  const { t } = useTranslation()
  const [page, setPage] = useState<Page>('chat')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)

  const refreshProjects = useCallback(async () => {
    const list = await api.listProjects()
    setProjects(list)
  }, [])

  const refreshConversations = useCallback(async () => {
    if (activeProjectId) {
      const active = await api.listConversationsByProject(activeProjectId)
      const archived = await api.listConversationsByProject(activeProjectId, true)
      setConversations([...active, ...archived])
    } else {
      const list = await api.listConversations()
      setConversations(list)
    }
    return conversations
  }, [activeProjectId])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  useEffect(() => {
    refreshConversations()
  }, [refreshConversations])

  useEffect(() => {
    const promise = listen('conversation-updated', () => {
      refreshConversations()
    })
    return () => { promise.then((fn) => fn()) }
  }, [refreshConversations])

  const handleCreate = useCallback(async () => {
    const conv = await api.createConversation(undefined, activeProjectId ?? undefined)
    const list = await refreshConversations()
    setActiveId(conv.id)
    setPage('chat')
    return list
  }, [refreshConversations, activeProjectId])

  const handleDelete = useCallback(
    async (id: string) => {
      await api.deleteConversation(id)
      await refreshConversations()
      if (activeId === id) {
        setActiveId(null)
      }
    },
    [activeId, refreshConversations],
  )

  const handleSelect = useCallback(
    (id: string) => {
      setActiveId(id)
      setPage('chat')
    },
    [],
  )

  const handleSelectProject = useCallback((id: string | null) => {
    setActiveProjectId(id)
    setActiveId(null)
  }, [])

  const handleCreateProject = useCallback(async (name: string, path: string) => {
    await api.createProject(name, path)
    await refreshProjects()
  }, [refreshProjects])

  const activeConversation = conversations.find((c) => c.id === activeId)
  const activeProject = projects.find((p) => p.id === activeProjectId)

  return (
    <SidebarProvider>
      <AppSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onOpenSettings={() => setPage('settings')}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onCreateProject={handleCreateProject}
      />
      <SidebarInset className="flex flex-col overflow-hidden">
        <header className="flex items-center min-h-12 gap-2 px-4 pt-[var(--safe-top)] pb-[var(--safe-top)] border-b border-border select-none shrink-0" data-tauri-drag-region>
          <SidebarTrigger className="-ml-1" />
          <span className="text-sm font-medium">
            {page === 'settings'
              ? t('settings.title')
              : activeConversation?.title ?? (activeProject?.name ?? t('app.name'))}
          </span>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden">
          {page === 'settings' ? (
            <SettingsPage />
          ) : activeId ? (
            <ChatView conversationId={activeId} />
          ) : (
            <EmptyState onCreate={handleCreate} />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
