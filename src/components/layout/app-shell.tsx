import { Suspense, lazy, useState } from 'react'

import { Sidebar } from '@heroui-pro/react/sidebar'
import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
import { useBackGesture, useHistoryLevel } from '@/hooks/use-history-level'
import { AppSidebar } from './app-sidebar'
import type { ShellProps } from './shell-props'

const SettingsPage = lazy(() => import('@/components/settings'))

/**
 * The whole application frame, on every platform.
 *
 * There were two of these. The phone had a stack of screens — a conversation
 * list, a settings index, a settings section — pushed over an always-mounted
 * chat, and the desktop had this. Two shells meant two answers to every
 * question, and the seam between them was a width read once at startup: a
 * Windows window dragged narrow kept the panel it could no longer show, and a
 * tablet in landscape got the desktop shell it had not been designed for.
 *
 * One frame instead. The sidebar is the conversation list, as a panel above
 * 768px and as a sheet below it — Pro renders both from the same tree — and
 * settings is a page beside the chat rather than a screen on top of it. What
 * the phone loses is nothing it had: the back gesture still closes the sheet,
 * because that is a level (`useHistoryLevel`), which is all the stack was
 * really being used for by the end.
 *
 * Nothing here branches on width. The one platform question left is who owns
 * the back gesture, and that is a property of the device, not of the viewport.
 */
export function AppShell(props: ShellProps) {
  const {
    conversations, activeId, projects, activeProjectId, page, settingsTab,
    pendingMessage, headerTitle, canDragWindow,
    onSelect, onCreate, onDelete, onRename, onTogglePin, onSelectProject,
    onCreateProject, onDeleteProject, onRenameProject, onOpenSettings,
    onCloseSettings, onSettingsTabChange, onCreateWithMessage,
    onInitialMessageConsumed,
  } = props

  // Controlled on purpose. Left uncontrolled, Pro writes the state to a
  // `sidebar_state` cookie on every toggle — a Next.js convention, useless here
  // (nothing reads it back) and one more thing to have an opinion about under a
  // custom protocol. Persisting the state is a store field if we ever want it.
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useBackGesture()
  // Settings was a screen in the stack, and the back key left it. It is a page
  // now, so it has to claim its own level to keep doing that.
  useHistoryLevel(page === 'settings', onCloseSettings)

  return (
    <Sidebar.Provider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      variant="inset"
      collapsible="icon"
      // Pro's provider is `min-h-svh`: a page that grows. This one is a fixed
      // viewport with its own scrollers inside, and the transcript's scroller
      // needs a container that does not move to measure against.
      className="h-svh overflow-hidden pb-[var(--ime-bottom,0px)]"
    >
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
      <Sidebar.Main className="overflow-hidden">
        <header
          className="flex items-center min-h-12 gap-2 px-4 pt-[var(--safe-top)] pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))] border-b border-border select-none shrink-0"
          data-tauri-drag-region={canDragWindow ? '' : undefined}
        >
          {/* Below 768px this is the only way to the conversation list, so it
              is sized for a thumb rather than for a pointer. */}
          <Sidebar.Trigger className="-ml-1 size-10 md:size-8" />
          <span className="text-sm font-medium truncate">{headerTitle}</span>
        </header>

        {/* The conversation stays mounted under the settings page rather than
            being swapped out for it. Unmounting `ChatView` would take the draft
            in the composer and the transcript's scroll position with it, and
            coming back to a cleared composer reads as data loss.

            `inert` rather than `hidden`: the transcript's scroller measures
            itself every frame and watches intersections, and `display: none`
            collapses all of that to zero, so restoring it jumps back to the
            top. Inert keeps the layout exactly where it was while taking the
            subtree out of reach of focus and pointers. */}
        <main className="relative flex-1 min-h-0 overflow-hidden">
          <div className="flex h-full flex-col" inert={page === 'settings' || undefined}>
            {activeId ? (
              <ChatView
                key={activeId}
                conversationId={activeId}
                initialMessage={pendingMessage}
                onInitialMessageConsumed={onInitialMessageConsumed}
              />
            ) : (
              <EmptyState onSubmit={onCreateWithMessage} />
            )}
          </div>

          {page === 'settings' && (
            <div data-slot="settings-layer" className="absolute inset-0 z-20 bg-background">
              {/* No spinner: the chunk is on local disk and resolves within a
                  frame or two, where a flash of "loading" would read as jank. */}
              <Suspense fallback={null}>
                <SettingsPage activeTab={settingsTab} />
              </Suspense>
            </div>
          )}
        </main>
      </Sidebar.Main>
    </Sidebar.Provider>
  )
}
