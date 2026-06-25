import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
import SettingsPage from '@/components/settings'
import type { SettingsTab } from '@/components/settings'
import { api } from '@/api'
import DecryptedText from '@/components/DecryptedText'
import { useContextMenuGuard } from '@/hooks/use-context-menu-guard'
import type { Conversation, Project } from '@/types'

type Page = 'chat' | 'settings'

function App() {
  const { t } = useTranslation()
  useContextMenuGuard()
  const [page, setPage] = useState<Page>('chat')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('provider')
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

  const handleRename = useCallback(async (id: string, newTitle: string) => {
    await api.updateConversationTitle(id, newTitle)
    await refreshConversations()
  }, [refreshConversations])

  const handleTogglePin = useCallback(async (id: string) => {
    await api.togglePinConversation(id)
    await refreshConversations()
  }, [refreshConversations])

  const handleDeleteProject = useCallback(async (id: string) => {
    await api.deleteProject(id)
    await refreshProjects()
    if (activeProjectId === id) {
      setActiveProjectId(null)
    }
  }, [refreshProjects, activeProjectId])

  const handleRenameProject = useCallback(async (id: string, newName: string) => {
    await api.updateProject(id, { name: newName })
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
        page={page}
        onOpenSettings={() => setPage('settings')}
        onCloseSettings={() => setPage('chat')}
        settingsTab={settingsTab}
        onSettingsTabChange={setSettingsTab}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onCreateProject={handleCreateProject}
        onRename={handleRename}
        onTogglePin={handleTogglePin}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
      />
      <SidebarInset className="flex flex-col overflow-hidden">
        <header className="flex items-center min-h-12 gap-2 px-4 pt-[var(--safe-top)] pb-[var(--safe-top)] border-b border-border select-none shrink-0" data-tauri-drag-region>
          <SidebarTrigger className="-ml-1" />
          <span className="text-sm font-medium">
            {page === 'settings'
              ? t('settings.title')
              : (() => {
                  const title = activeConversation?.title ?? (activeProject?.name ?? t('app.name'))
                  return <DecryptedText key={title} text={title} animateOn="view" speed={30} sequential revealDirection="start" />
                })()}
          </span>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden">
          {page === 'settings' ? (
            <SettingsPage activeTab={settingsTab} />
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
