import type { SettingsTab } from '@/components/settings/tabs'
import type { Page } from '@/lib/nav'
import type { Conversation, Project } from '@/types'

/**
 * Everything both shells need from `App`.
 *
 * App stays the one place holding this state; the shells only arrange it. The
 * two of them render the same leaf components — `ChatView`, the conversation
 * list, the settings panels — and differ in the frame around them, which is
 * what keeps a phone from growing its own copy of the application.
 */
export interface ShellProps {
  conversations: Conversation[]
  activeId: string | null
  projects: Project[]
  activeProjectId: string | null
  page: Page
  settingsTab: SettingsTab
  pendingMessage: string | null
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
  onDeleteProject: (id: string) => void
  onRenameProject: (id: string, newName: string) => void
  onOpenSettings: () => void
  onCloseSettings: () => void
  onSettingsTabChange: (tab: SettingsTab) => void
  onCreateWithMessage: (text: string) => void
  onInitialMessageConsumed: () => void
}
