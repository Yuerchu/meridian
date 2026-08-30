import { Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@heroui/react'
import { Sidebar } from '@heroui-pro/react/sidebar'
import { Resizable } from '@heroui-pro/react/resizable'
import { FolderTree, Magnifier } from '@gravity-ui/icons'
import { ChangesPanel } from '@/components/chat/changes-panel'
import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
import { useBackGesture, useHistoryLevel } from '@/hooks/use-history-level'
import { useHotkey } from '@/hooks/use-hotkey'
import { useIsMobile } from '@/hooks/use-mobile'
import { ApprovalToastRegion } from './approval-toasts'
import { AppSidebar } from './app-sidebar'
import { CommandPalette } from './command-palette'
import { RemoteStatus } from './remote-status'
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
    conversations,
    activeId,
    projects,
    activeProjectId,
    page,
    settingsTab,
    pendingDraft,
    headerTitle,
    canDragWindow,
    onSelect,
    onCreate,
    onDelete,
    onRename,
    onTogglePin,
    onSelectProject,
    onCreateProject,
    onCreateHostedSession,
    onDeleteProject,
    onRenameProject,
    onOpenSettings,
    onCloseSettings,
    onSettingsTabChange,
    onCreateWithDraft,
    onInitialDraftConsumed,
  } = props

  // Controlled on purpose. Left uncontrolled, Pro writes the state to a
  // `sidebar_state` cookie on every toggle — a Next.js convention, useless here
  // (nothing reads it back) and one more thing to have an opinion about under a
  // custom protocol. Persisting the state is a store field if we ever want it.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Local state, not a store field. Its lifetime would be identical either way
  // — neither survives a reload — and a width in the store would be written on
  // every frame of a drag, with the transcript subscribed to the same store.
  // Resizable keeps the width itself for as long as the panel is open, which is
  // the only span over which it means anything.
  const [changesOpen, setChangesOpen] = useState(false)
  const { t } = useTranslation()

  // `ignoreInInput: false` on purpose, and it is the only shortcut that gets
  // it: wanting to jump somewhere else in the middle of writing a message is
  // exactly the moment this exists for.
  useHotkey('mod+k', () => setPaletteOpen(true), { ignoreInInput: false })

  // Not folded into the `&&` below: short-circuiting past a hook call is how a
  // conditional hook gets written by accident.
  const isMobile = useIsMobile()
  // Nothing to list without a conversation, and no room to list it in below
  // `md` — the panel would leave the transcript a column too narrow to read.
  // Unmounted rather than hidden with a class: a hidden panel still builds the
  // tree and subscribes to the session.
  const showChanges = changesOpen && activeId !== null && !isMobile

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
        onCreateHostedSession={onCreateHostedSession}
        onRename={onRename}
        onTogglePin={onTogglePin}
        onDeleteProject={onDeleteProject}
        onRenameProject={onRenameProject}
      />
      {/* `min-h-0` is what makes the keyboard inset above actually do
          something. `.sidebar__main` is `min-height: 100svh` (`calc(100svh -
          1rem)` under `variant="inset"`), so shrinking the provider's content
          box leaves this pane insisting on a full viewport regardless — the
          composer stays under the keyboard and nothing moves. It stretches to
          the provider either way, so removing the floor costs nothing on a
          desktop and is the whole fix on a phone. The shell that used to serve
          phones owned a plain `div` here, which is why this never came up. */}
      <Sidebar.Main className="min-h-0 overflow-hidden">
        <header
          className="flex items-center min-h-12 gap-2 px-4 pt-[var(--safe-top)] pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))] border-b border-border select-none shrink-0"
          data-tauri-drag-region={canDragWindow ? '' : undefined}
        >
          {/* Below 768px this is the only way to the conversation list, so it
              is sized for a thumb rather than for a pointer. */}
          <Sidebar.Trigger className="-ml-1 size-10 md:size-8" />
          <span className="text-sm font-medium truncate">{headerTitle}</span>
          {/* Beside the title rather than in the group of buttons on the right:
              it is not something to press, and it renders nothing at all while
              the connection is healthy — which on a desktop is always. */}
          <RemoteStatus />
          {/* The palette's other door. A phone has no `mod` key to press, and
              on a desktop a shortcut nobody has written down is a shortcut
              nobody uses — the tooltip is where it gets written down. */}
          {/* One `ml-auto`, on the group. Two auto margins split the free space
              between them and leave a gap in the middle of the pair. */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* Only where the panel it toggles can open. */}
            {activeId && !isMobile && page !== 'settings' && (
              <Tooltip>
                <Button
                  isIconOnly
                  variant={changesOpen ? 'secondary' : 'ghost'}
                  aria-label={t('chat.changes.toggle')}
                  aria-pressed={changesOpen}
                  onClick={() => setChangesOpen((open) => !open)}
                  className="size-10 md:size-8"
                >
                  <FolderTree />
                </Button>
                <Tooltip.Content placement="bottom">{t('chat.changes.toggle')}</Tooltip.Content>
              </Tooltip>
            )}
            <Tooltip>
              <Button
                isIconOnly
                variant="ghost"
                aria-label={t('palette.title')}
                onClick={() => setPaletteOpen(true)}
                className="size-10 md:size-8"
              >
                <Magnifier />
              </Button>
              <Tooltip.Content placement="bottom">
                {t('palette.title')}
                <kbd className="ml-2 text-xs opacity-70">⌘K</kbd>
              </Tooltip.Content>
            </Tooltip>
          </div>
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
            {/* The split lives inside the chat branch, not around it: `<main>`
                is the positioned box the settings layer covers, and a group
                that enclosed both would have the settings page inside a panel
                it has no business being in. */}
            <Resizable orientation="horizontal" className="h-full min-h-0">
              <Resizable.Panel id="chat" minSize={35}>
                {/* `min-w-0` or a flex child refuses to shrink, and the
                    transcript's `max-w-4xl mx-auto` overflows instead of
                    narrowing. */}
                <div className="flex h-full min-w-0 flex-col">
                  {activeId ? (
                    <ChatView
                      key={activeId}
                      conversationId={activeId}
                      initialDraft={pendingDraft}
                      onInitialDraftConsumed={onInitialDraftConsumed}
                    />
                  ) : (
                    <EmptyState onSubmit={onCreateWithDraft} />
                  )}
                </div>
              </Resizable.Panel>
              {/* Conditional rather than `collapsible`. Collapsed-to-zero and
                  closed are two states that look identical and can disagree,
                  and the one that can disagree is the one that produces a panel
                  nobody can get back. */}
              {showChanges && activeId && (
                <>
                  {/* Pro's handle is a 1px line with an 8px hit area, which is a
                      pointer's measurement. This panel only mounts above 768px,
                      and a touch laptop or a tablet in landscape is squarely in
                      that range — the divider was there and could not be
                      dragged. The line itself is unchanged; only what catches
                      the finger grows. */}
                  <Resizable.Handle
                    aria-label={t('chat.changes.title')}
                    className="[--resizable-handle-hit-area:16px] pointer-coarse:[--resizable-handle-hit-area:24px]"
                  />
                  <Resizable.Panel id="changes" defaultSize={30} minSize={18} maxSize={50}>
                    <ChangesPanel conversationId={activeId} onClose={() => setChangesOpen(false)} />
                  </Resizable.Panel>
                </>
              )}
            </Resizable>
          </div>

          {/* `bg-surface`, not `bg-background`: this covers `Sidebar.Main`,
              which Pro paints `--surface`, and the two are different colours in
              both themes. */}
          {page === 'settings' && (
            <div data-slot="settings-layer" className="absolute inset-0 z-20 bg-surface">
              {/* No spinner: the chunk is on local disk and resolves within a
                  frame or two, where a flash of "loading" would read as jank. */}
              <Suspense fallback={null}>
                {/* `onSelect` is the existing navigation boundary: it changes
                    the active conversation and closes settings in one action. */}
                <SettingsPage activeTab={settingsTab} onOpenConversation={onSelect} />
              </Suspense>
            </div>
          )}
        </main>
      </Sidebar.Main>

      {/* Outside `Sidebar.Main`, beside the palette: its region is `fixed`, and
          what it draws is about no particular pane. It sits above the settings
          layer by z-index, which is right — a conversation stopping on a
          permission prompt is not something being in settings should hide. */}
      <ApprovalToastRegion onSelect={onSelect} transcriptInert={page === 'settings'} />

      <CommandPalette
        isOpen={paletteOpen}
        onOpenChange={setPaletteOpen}
        conversations={conversations}
        projects={projects}
        onSelectConversation={onSelect}
        onSelectProject={onSelectProject}
        onOpenSettingsTab={(tab) => {
          onSettingsTabChange(tab)
          onOpenSettings()
        }}
        onCreate={onCreate}
      />
    </Sidebar.Provider>
  )
}
