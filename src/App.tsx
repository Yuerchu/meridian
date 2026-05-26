import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
import SettingsPage from '@/components/settings'
import { api } from '@/api'
import type { Conversation } from '@/types'

type Page = 'chat' | 'settings'

function App() {
  const { t } = useTranslation()
  const [page, setPage] = useState<Page>('chat')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const refreshConversations = useCallback(async () => {
    const list = await api.listConversations()
    setConversations(list)
    return list
  }, [])

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
    const conv = await api.createConversation()
    const list = await refreshConversations()
    setActiveId(conv.id)
    setPage('chat')
    return list
  }, [refreshConversations])

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

  const activeConversation = conversations.find((c) => c.id === activeId)

  return (
    <SidebarProvider>
      <AppSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onOpenSettings={() => setPage('settings')}
      />
      <SidebarInset className="flex flex-col overflow-hidden">
        <header className="flex items-center h-12 gap-2 px-4 border-b border-border select-none shrink-0" data-tauri-drag-region>
          <SidebarTrigger className="-ml-1" />
          <span className="text-sm font-medium">
            {page === 'settings'
              ? t('settings.title')
              : activeConversation?.title ?? t('app.name')}
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
