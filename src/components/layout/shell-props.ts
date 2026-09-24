import type { SettingsTab } from '@/components/settings/tabs'
import type { InitialTurnDraft } from '@/components/chat/conversation-draft'
import type { ConversationInfoResponse, ProjectInfoResponse } from '@/types'

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
  conversations: ConversationInfoResponse[]
  activeId: string | null
  projects: ProjectInfoResponse[]
  activeProjectId: string | null
  page: Page
  settingsTab: SettingsTab
  pendingDraft: InitialTurnDraft | null
  /** Title for the header, already resolved from the active conversation. */
  headerTitle: string
  canDragWindow: boolean

  onSelect: (id: string) => void
  /** Start a conversation — under `projectId` when given, under the active
   *  project when the argument is omitted, loose when it is `null`. */
  onCreate: (projectId?: string | null) => void | Promise<void>
  /** These and the two project handlers reject on failure; the sidebar reports it. */
  onDelete: (id: string) => Promise<void>
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
  /** Refile a conversation under another project, or under none (`null`). */
  onMoveToProject: (id: string, projectId: string | null) => Promise<string | null>
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => void | Promise<void>
  /** Start a hosted Claude Code session. Resolves to why it failed, or `null`. */
  onCreateHostedSession: (cwd: string) => Promise<string | null>
  onDeleteProject: (id: string) => Promise<void>
  onRenameProject: (id: string, newName: string) => Promise<void>
  onOpenSettings: () => void
  onCloseSettings: () => void
  onSettingsTabChange: (tab: SettingsTab) => void
  onCreateWithDraft: (draft: InitialTurnDraft) => Promise<void>
  onInitialDraftConsumed: () => void
}
