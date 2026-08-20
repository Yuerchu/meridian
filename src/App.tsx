import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '@/components/layout/app-shell'
import type { Page, ShellProps } from '@/components/layout/shell-props'
import type { SettingsTab } from '@/components/settings/tabs'
import { api } from '@/api'
import { useContextMenuGuard } from '@/hooks/use-context-menu-guard'
import { useAndroidInsets } from '@/hooks/use-android-insets'
import { usePlatform } from '@/hooks/use-platform'
import { useGlobalEventListener } from '@/hooks/use-global-event-listener'
import { useConversationStore } from '@/stores/conversation-store'

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

  // Tauri injects its drag script unconditionally, but `start_dragging` is
  // `#[cfg(desktop)]` — on a phone every tap on the header invokes a command
  // that was never registered and rejects, and the script's
  // `stopImmediatePropagation` eats the mousedown on the way past. There is no
  // window to drag there anyway. `null` on the first frame counts as not
  // desktop: the attribute is cheaper to add late than to have acted on.
  const platform = usePlatform()
  const canDragWindow = platform !== null && platform !== 'android' && platform !== 'ios'

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

  // Once, not once per project: the list is every conversation now, and the
  // sidebar groups them itself.
  useEffect(() => {
    refreshConversations()
  }, [refreshConversations])

  const handleCreate = useCallback(async () => {
    const conv = await api.createConversation(undefined, activeProjectId ?? undefined)
    await refreshConversations()
    storeSetActiveId(conv.id)
    setPage('chat')
  }, [refreshConversations, activeProjectId, storeSetActiveId])

  const handleCreateWithMessage = useCallback(
    async (text: string) => {
      const conv = await api.createConversation(undefined, activeProjectId ?? undefined)
      await refreshConversations()
      setPendingMessage(text)
      storeSetActiveId(conv.id)
      setPage('chat')
    },
    [refreshConversations, activeProjectId, storeSetActiveId],
  )

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

  const handleSelectProject = useCallback(
    (id: string | null) => {
      storeSetActiveProjectId(id)
    },
    [storeSetActiveProjectId],
  )

  const handleCreateProject = useCallback(
    async (name: string, path: string) => {
      await api.createProject(name, path)
      await refreshProjects()
    },
    [refreshProjects],
  )

  /**
   * Start a hosted session, and hand back what went wrong if it did.
   *
   * The adapter starts *before* the conversation exists, so this takes a few
   * seconds and can fail outright — `npx` not installed, the folder gone, the
   * agent not signed in. There is no conversation to hang that error on yet,
   * which is why it goes back to the form that asked rather than to a
   * transcript. `null` means it worked.
   */
  const handleCreateHostedSession = useCallback(
    async (cwd: string): Promise<string | null> => {
      try {
        const conversationId = await api.acpOpenSession(cwd)
        await refreshConversations()
        storeSetActiveId(conversationId)
        setPage('chat')
        return null
      } catch (err) {
        return String(err)
      }
    },
    [refreshConversations, storeSetActiveId],
  )

  const handleRename = useCallback(
    async (id: string, newTitle: string) => {
      await api.updateConversationTitle(id, newTitle)
      await refreshConversations()
    },
    [refreshConversations],
  )

  const handleTogglePin = useCallback(
    async (id: string) => {
      await api.togglePinConversation(id)
      await refreshConversations()
    },
    [refreshConversations],
  )

  const handleDeleteProject = useCallback(
    async (id: string) => {
      await api.deleteProject(id)
      await refreshProjects()
      if (activeProjectId === id) {
        storeSetActiveProjectId(null)
      }
    },
    [refreshProjects, activeProjectId, storeSetActiveProjectId],
  )

  const handleRenameProject = useCallback(
    async (id: string, newName: string) => {
      await api.updateProject(id, { name: newName })
      await refreshProjects()
    },
    [refreshProjects],
  )

  const activeConversation = conversations.find((c) => c.id === activeId)
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const shellProps: ShellProps = {
    conversations,
    activeId,
    projects,
    activeProjectId,
    page,
    settingsTab,
    pendingMessage,
    headerTitle:
      page === 'settings' ? t('settings.title') : (activeConversation?.title ?? activeProject?.name ?? t('app.name')),
    canDragWindow,
    onSelect: handleSelect,
    onCreate: handleCreate,
    onDelete: handleDelete,
    onRename: handleRename,
    onTogglePin: handleTogglePin,
    onSelectProject: handleSelectProject,
    onCreateProject: handleCreateProject,
    onCreateHostedSession: handleCreateHostedSession,
    onDeleteProject: handleDeleteProject,
    onRenameProject: handleRenameProject,
    onOpenSettings: () => setPage('settings'),
    onCloseSettings: () => setPage('chat'),
    onSettingsTabChange: setSettingsTab,
    onCreateWithMessage: handleCreateWithMessage,
    onInitialMessageConsumed: () => setPendingMessage(null),
  }

  return <AppShell {...shellProps} />
}

export default App
