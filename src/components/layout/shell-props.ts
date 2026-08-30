import type { SettingsTab } from '@/components/settings/tabs'
import type { InitialTurnDraft } from '@/components/chat/conversation-draft'
import type { Conversation, Project } from '@/types'

/**
 * What fills the pane beside the sidebar.
 *
 * The sidebar is always there — as a panel on a wide window, as a sheet on a
 * narrow one — so this is the only thing a screen change ever decides. There
 * was once a second, stack-shaped answer for phones; one shell means one.
 */
export type Page = 'chat' | 'settings'

/**
 * Everything the shell needs from `App`.
 *
 * App stays the one place holding this state; the shell only arranges it. Its
 * own file rather than the shell's, because `app-sidebar.tsx` needs {@link Page}
 * and importing it from the shell would close a cycle.
 */
export interface ShellProps {
  conversations: Conversation[]
  activeId: string | null
  projects: Project[]
  activeProjectId: string | null
  page: Page
  settingsTab: SettingsTab
  pendingDraft: InitialTurnDraft | null
  /** Title for the header, already resolved from the active conversation. */
  headerTitle: string
  canDragWindow: boolean

  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => void
  onTogglePin: (id: string) => void
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => void
  /** Start a hosted Claude Code session. Resolves to why it failed, or `null`. */
  onCreateHostedSession: (cwd: string) => Promise<string | null>
  onDeleteProject: (id: string) => void
  onRenameProject: (id: string, newName: string) => void
  onOpenSettings: () => void
  onCloseSettings: () => void
  onSettingsTabChange: (tab: SettingsTab) => void
  onCreateWithDraft: (draft: InitialTurnDraft) => Promise<void>
  onInitialDraftConsumed: () => void
}
