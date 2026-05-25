import { useCallback, useEffect, useState } from 'react'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ChatView } from '@/components/chat/chat-view'
import Settings from '@/components/Settings'
import { api } from '@/api'
import type { Conversation } from '@/types'

type Page = 'chat' | 'settings'

function App() {
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
      <SidebarInset>
        <header className="flex items-center h-12 gap-2 px-4 border-b border-neutral-800 select-none" data-tauri-drag-region>
          <SidebarTrigger className="-ml-1" />
          <span className="text-sm font-medium">
            {page === 'settings'
              ? 'Settings'
              : activeConversation?.title ?? 'Meridian'}
          </span>
        </header>

        <main className="flex-1 overflow-hidden">
          {page === 'settings' ? (
            <Settings />
          ) : activeId ? (
            <ChatView conversationId={activeId} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-neutral-500">
              <p className="text-sm">No conversation selected</p>
              <button
                onClick={handleCreate}
                className="px-4 py-2 text-sm bg-neutral-100 text-neutral-900 rounded-lg hover:bg-neutral-200"
              >
                New Chat
              </button>
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
