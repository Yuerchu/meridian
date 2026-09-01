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
import type { InitialTurnDraft } from '@/components/chat/conversation-draft'
import type { ConversationInfoResponse } from '@/types'

/** How long to wait for a stopped turn to let go of its conversation before
 *  giving up and surfacing the refusal. */
const RELEASE_POLL_MS = 100
const RELEASE_ATTEMPTS = 20

function keepConversationLocally(conversation: ConversationInfoResponse) {
  useConversationStore.setState((state) => ({
    conversations: state.conversations.some((entry) => entry.id === conversation.id)
      ? state.conversations
      : [conversation, ...state.conversations],
  }))
}

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
  const [pendingTurn, setPendingTurn] = useState<{ conversationId: string; draft: InitialTurnDraft } | null>(null)

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
    const conv = await api.createConversation({ title: null, projectId: activeProjectId })
    try {
      await refreshConversations()
    } catch {
      // The row already exists. Treat a list refresh as cache repair rather
      // than creation failure, otherwise retrying from the shell duplicates it.
      keepConversationLocally(conv)
    }
    storeSetActiveId(conv.id)
    setPage('chat')
  }, [refreshConversations, activeProjectId, storeSetActiveId])

  const handleCreateWithDraft = useCallback(
    async (draft: InitialTurnDraft) => {
      const conv = await api.createConversation({ title: null, projectId: activeProjectId })
      const { settings } = draft
      // A welcome-page toolbar is real, not decorative. Persist every setting
      // that has a conversation column before the first turn starts; the model
      // and provider remain first-turn overrides and travel in `pendingTurn`.
      try {
        const results = await Promise.allSettled([
          settings.selectedAssistantId
            ? api.setConversationAssistant({ id: conv.id, assistantId: settings.selectedAssistantId })
            : Promise.resolve(),
          api.setConversationReasoningPrefs({
            id: conv.id,
            thinkingLevel: settings.thinkingLevel === 'default' ? null : settings.thinkingLevel,
            fastMode: settings.fastMode,
          }),
          api.setConversationMode({ id: conv.id, mode: settings.mode === 'work' ? null : settings.mode }),
          api.setConversationAcceptEdits({ id: conv.id, acceptEdits: settings.acceptEdits }),
        ])
        // Wait for every SQLite write before cleanup. Promise.all would enter
        // the catch on the first rejection and race deletion against the other
        // writes that are still in flight.
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (rejected) throw rejected.reason
      } catch (settingsError) {
        // The row has no message yet. Remove that incomplete shell before
        // returning the intact draft to the welcome page, otherwise every
        // retry creates another orphaned conversation.
        let failure = settingsError
        try {
          await api.deleteConversation(conv.id)
        } catch (cleanupError) {
          failure = new Error(`${String(settingsError)}; cleanup failed: ${String(cleanupError)}`)
        }
        try {
          await refreshConversations()
        } catch {
          // The original settings/cleanup error is the actionable one.
        }
        throw failure
      }
      // Prefer putting the real row in the store before ChatView mounts so its
      // persisted assistant/mode selectors are immediately authoritative. A
      // refresh failure is still presentation state: the draft seed below is
      // a complete fallback and must be allowed to start the valid conversation.
      try {
        await refreshConversations()
      } catch (err) {
        keepConversationLocally({
          ...conv,
          assistant_id: settings.selectedAssistantId ?? conv.assistant_id,
          thinking_level: settings.thinkingLevel === 'default' ? null : settings.thinkingLevel,
          fast_mode: settings.fastMode,
          mode: settings.mode === 'work' ? null : settings.mode,
          accept_edits: settings.acceptEdits,
        })
        console.error('Failed to refresh conversations', err)
      }
      setPendingTurn({ conversationId: conv.id, draft })
      storeSetActiveId(conv.id)
      setPage('chat')
    },
    [refreshConversations, activeProjectId, storeSetActiveId],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const session = useConversationStore.getState().sessions[id]
      if (session?.streaming) {
        await api.stopChat({ conversationId: id, turnId: session.activeTurnId })
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
      const project = await api.createProject({
        name,
        path,
        sourceType: 'local',
        sourceId: null,
        assistantId: null,
        description: null,
      })
      try {
        await refreshProjects()
      } catch {
        // Creation is already committed. Keep the new row visible and resolve
        // successfully so retrying the form cannot create a duplicate project.
        useConversationStore.setState((state) => ({
          projects: state.projects.some((entry) => entry.id === project.id)
            ? state.projects
            : [...state.projects, project],
        }))
      }
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
      let conversationId: string
      try {
        conversationId = await api.acpOpenSession({ cwd })
      } catch (err) {
        return String(err)
      }
      try {
        await refreshConversations()
      } catch {
        // The hosted process and its conversation already exist. Navigation by
        // id still works; a later refresh repairs the sidebar cache.
      }
      storeSetActiveId(conversationId)
      setPage('chat')
      return null
    },
    [refreshConversations, storeSetActiveId],
  )

  const handleRename = useCallback(
    async (id: string, newTitle: string) => {
      await api.updateConversationTitle({ id, title: newTitle })
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

  const handleMoveToProject = useCallback(
    async (id: string, projectId: string | null): Promise<string | null> => {
      try {
        await api.setConversationProject({ id, projectId })
        await refreshConversations()
        return null
      } catch (err) {
        return String(err)
      }
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
      await api.updateProject({ id, name: newName })
      await refreshProjects()
    },
    [refreshProjects],
  )

  const activeConversation = conversations.find((c) => c.id === activeId)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const appName = t('app.name')
  const headerTitle =
    page === 'settings' ? t('settings.title') : (activeConversation?.title ?? activeProject?.name ?? appName)

  useEffect(() => {
    document.title = headerTitle === appName ? appName : `${headerTitle} — ${appName}`
  }, [appName, headerTitle])

  const shellProps: ShellProps = {
    conversations,
    activeId,
    projects,
    activeProjectId,
    page,
    settingsTab,
    pendingDraft: pendingTurn?.conversationId === activeId ? pendingTurn.draft : null,
    headerTitle,
    canDragWindow,
    onSelect: handleSelect,
    onCreate: handleCreate,
    onDelete: handleDelete,
    onRename: handleRename,
    onTogglePin: handleTogglePin,
    onMoveToProject: handleMoveToProject,
    onSelectProject: handleSelectProject,
    onCreateProject: handleCreateProject,
    onCreateHostedSession: handleCreateHostedSession,
    onDeleteProject: handleDeleteProject,
    onRenameProject: handleRenameProject,
    onOpenSettings: () => setPage('settings'),
    onCloseSettings: () => setPage('chat'),
    onSettingsTabChange: setSettingsTab,
    onCreateWithDraft: handleCreateWithDraft,
    onInitialDraftConsumed: () => setPendingTurn(null),
  }

  return <AppShell {...shellProps} />
}

export default App
