import { Suspense, lazy } from 'react'

import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
import { AppSidebar } from './app-sidebar'
import type { ShellProps } from './shell-props'

const SettingsPage = lazy(() => import('@/components/settings'))

/**
 * The sidebar-and-pane layout, unchanged from when it was all of `App`.
 *
 * Nothing here is conditional on width: a narrow desktop window keeps the
 * sidebar, because the back gesture that a stack needs belongs to a phone
 * rather than to a viewport size.
 */
export function DesktopShell(props: ShellProps) {
  const {
    conversations, activeId, projects, activeProjectId, page, settingsTab,
    pendingMessage, headerTitle, canDragWindow,
    onSelect, onCreate, onDelete, onRename, onTogglePin, onSelectProject,
    onCreateProject, onDeleteProject, onRenameProject, onOpenSettings,
    onCloseSettings, onSettingsTabChange, onCreateWithMessage,
    onInitialMessageConsumed,
  } = props

  return (
    <SidebarProvider>
      <AppSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={onSelect}
        onCreate={onCreate}
        onDelete={onDelete}
        page={page}
        onOpenSettings={onOpenSettings}
        onCloseSettings={onCloseSettings}
        settingsTab={settingsTab}
        onSettingsTabChange={onSettingsTabChange}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={onSelectProject}
        onCreateProject={onCreateProject}
        onRename={onRename}
        onTogglePin={onTogglePin}
        onDeleteProject={onDeleteProject}
        onRenameProject={onRenameProject}
      />
      <SidebarInset className="flex flex-col overflow-hidden">
        <header
          className="flex items-center min-h-12 gap-2 px-4 pt-[var(--safe-top)] pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))] border-b border-border select-none shrink-0"
          data-tauri-drag-region={canDragWindow ? '' : undefined}
        >
          <SidebarTrigger className="-ml-1" />
          <span className="text-sm font-medium">{headerTitle}</span>
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
              onInitialMessageConsumed={onInitialMessageConsumed}
            />
          ) : (
            <EmptyState onSubmit={onCreateWithMessage} />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
