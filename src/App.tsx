import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
// Settings is a couple of dozen components behind a button most sessions never
// press. Split out so the chat window is not waiting on it to start.
const SettingsPage = lazy(() => import('@/components/settings'))
import type { SettingsTab } from '@/components/settings'
import { api } from '@/api'
import { useContextMenuGuard } from '@/hooks/use-context-menu-guard'
import { useAndroidInsets } from '@/hooks/use-android-insets'
import { useGlobalEventListener } from '@/hooks/use-global-event-listener'
import { useConversationStore } from '@/stores/conversation-store'

type Page = 'chat' | 'settings'

/** How long to wait for a stopped turn to let go of its conversation before
 *  giving up and surfacing the refusal. */
const RELEASE_POLL_MS = 100
const RELEASE_ATTEMPTS = 20

async function deleteWhenFree(id: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await api.deleteConversation(id)
      return
    } catch (err) {
      if (attempt >= RELEASE_ATTEMPTS) throw err
      await new Promise((resolve) => setTimeout(resolve, RELEASE_POLL_MS))
    }
  }
}

function App() {
  const { t } = useTranslation()
  useContextMenuGuard()
  useGlobalEventListener()
  useAndroidInsets()

  const [page, setPage] = useState<Page>('chat')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('provider')
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)

  const conversations = useConversationStore((s) => s.conversations)
  const activeId = useConversationStore((s) => s.activeId)
  const projects = useConversationStore((s) => s.projects)
  const activeProjectId = useConversationStore((s) => s.activeProjectId)
  const storeSetActiveId = useConversationStore((s) => s.setActiveId)
  const storeSetActiveProjectId = useConversationStore((s) => s.setActiveProjectId)
  const refreshConversations = useConversationStore((s) => s.refreshConversations)
  const refreshProjects = useConversationStore((s) => s.refreshProjects)

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  useEffect(() => {
    refreshConversations()
  }, [refreshConversations, activeProjectId])

  const handleCreate = useCallback(async () => {
    const conv = await api.createConversation(undefined, activeProjectId ?? undefined)
    await refreshConversations()
    storeSetActiveId(conv.id)
    setPage('chat')
  }, [refreshConversations, activeProjectId, storeSetActiveId])

  const handleCreateWithMessage = useCallback(async (text: string) => {
    const conv = await api.createConversation(undefined, activeProjectId ?? undefined)
    await refreshConversations()
    setPendingMessage(text)
    storeSetActiveId(conv.id)
    setPage('chat')
  }, [refreshConversations, activeProjectId, storeSetActiveId])

  const handleDelete = useCallback(
    async (id: string) => {
      const session = useConversationStore.getState().sessions[id]
      if (session?.streaming) {
        await api.stopChat(id, session.activeTurnId)
        // A stop is a signal, not a join. The turn keeps writing until it
        // reaches its next await, and the backend refuses to delete a
        // conversation someone is still writing to — so wait for it to let go
        // rather than reporting a refusal the user can do nothing about. The
        // turn notices at its next await, which is immediate on every path
        // that matters; failing after that beats deleting the rows out from
        // under a runner that is still appending to them.
        await deleteWhenFree(id)
      } else {
        await api.deleteConversation(id)
      }
      await refreshConversations()
      if (activeId === id) {
        storeSetActiveId(null)
      }
    },
    [activeId, refreshConversations, storeSetActiveId],
  )

  const handleSelect = useCallback(
    (id: string) => {
      storeSetActiveId(id)
      setPage('chat')
    },
    [storeSetActiveId],
  )

  const handleSelectProject = useCallback((id: string | null) => {
    storeSetActiveProjectId(id)
  }, [storeSetActiveProjectId])

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
      storeSetActiveProjectId(null)
    }
  }, [refreshProjects, activeProjectId, storeSetActiveProjectId])

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
        <header className="flex items-center min-h-12 gap-2 px-4 pt-[var(--safe-top)] border-b border-border select-none shrink-0" data-tauri-drag-region>
          <SidebarTrigger className="-ml-1" />
          <span className="text-sm font-medium">
            {page === 'settings'
              ? t('settings.title')
              : (activeConversation?.title ?? activeProject?.name ?? t('app.name'))}
          </span>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden">
          {page === 'settings' ? (
            // No spinner: the chunk is on local disk and resolves within a
            // frame or two, where a flash of "loading" would read as jank.
            <Suspense fallback={null}>
              <SettingsPage activeTab={settingsTab} />
            </Suspense>
          ) : activeId ? (
            <ChatView
              key={activeId}
              conversationId={activeId}
              initialMessage={pendingMessage}
              onInitialMessageConsumed={() => setPendingMessage(null)}
            />
          ) : (
            <EmptyState onSubmit={handleCreateWithMessage} />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
