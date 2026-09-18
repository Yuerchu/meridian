import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Kbd, Tooltip, TooltipTrigger } from '@/components/base'
import { Sidebar } from '@/components/base'
import { Resizable } from '@/components/base'
import { FolderTree, Magnifier, Xmark } from '@gravity-ui/icons'
import { ChangesPanel } from '@/components/chat/changes-panel'
import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
import { clearSettingsTabDirty, useSettingsTabDirty } from '@/components/settings/dirty-guard'
import { useConfirm } from '@/hooks/use-confirm'
import { useBackGesture, useHistoryLevel } from '@/hooks/use-history-level'
import { useHotkey } from '@/hooks/use-hotkey'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSidebarResize } from '@/hooks/use-sidebar-resize'
import { usePlatform } from '@/hooks/use-platform'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import { ApprovalToastRegion } from './approval-toasts'
import { AppSidebar } from './app-sidebar'
import { CommandPalette } from './command-palette'
import { RemoteStatus } from './remote-status'
import type { ShellProps } from './shell-props'

const SettingsPage = lazy(() => import('@/components/settings'))
const PlanReviewPage = lazy(() =>
  import('@/components/plan-review/plan-review-page').then((module) => ({ default: module.PlanReviewPage })),
)

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
    onToggleArchive,
    onMoveToProject,
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
  const [settingsHistoryClaimed, setSettingsHistoryClaimed] = useState(true)
  // Local state, not a store field. Its lifetime would be identical either way
  // — neither survives a reload — and a width in the store would be written on
  // every frame of a drag, with the transcript subscribed to the same store.
  // Resizable keeps the width itself for as long as the panel is open, which is
  // the only span over which it means anything.
  const [changesOpen, setChangesOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const settingsDirty = useSettingsTabDirty(settingsTab)
  const platform = usePlatform()
  const pageHeadingRef = useRef<HTMLHeadingElement>(null)
  const previousPageRef = useRef(page)
  const activeReviewId = usePlanReviewStore((state) => state.activeReviewId)
  const closePlanReview = usePlanReviewStore((state) => state.closeReview)

  useEffect(() => {
    if (previousPageRef.current === page) return
    previousPageRef.current = page
    pageHeadingRef.current?.focus({ preventScroll: true })
  }, [page])

  // `ignoreInInput: false` on purpose, and it is the only shortcut that gets
  // it: wanting to jump somewhere else in the middle of writing a message is
  // exactly the moment this exists for.
  useHotkey('mod+k', () => setPaletteOpen(true), { ignoreInInput: false })

  // Not folded into the `&&` below: short-circuiting past a hook call is how a
  // conditional hook gets written by accident.
  const isMobile = useIsMobile()
  const { resetWidth, handleProps: resizeHandleProps } = useSidebarResize()
  // Nothing to list without a conversation, and no room to list it in below
  // `md` — the panel would leave the transcript a column too narrow to read.
  // Unmounted rather than hidden with a class: a hidden panel still builds the
  // tree and subscribes to the session.
  const showChanges = changesOpen && activeId !== null && !isMobile

  const requestLeaveSettings = useCallback(async () => {
    if (!settingsDirty) return true
    return confirm({ body: t('settings.unsavedChanges'), status: 'warning' })
  }, [confirm, settingsDirty, t])

  const changeSettingsTab = useCallback(
    async (tab: typeof settingsTab) => {
      if (tab === settingsTab) return true
      if (!(await requestLeaveSettings())) return false
      clearSettingsTabDirty(settingsTab)
      onSettingsTabChange(tab)
      return true
    },
    [onSettingsTabChange, requestLeaveSettings, settingsTab],
  )

  const closeSettings = useCallback(async () => {
    if (!(await requestLeaveSettings())) return false
    clearSettingsTabDirty(settingsTab)
    onCloseSettings()
    return true
  }, [onCloseSettings, requestLeaveSettings, settingsTab])

  const selectConversation = useCallback(
    async (id: string) => {
      if (page === 'settings') {
        if (!(await requestLeaveSettings())) return false
        clearSettingsTabDirty(settingsTab)
      }
      closePlanReview()
      onSelect(id)
      return true
    },
    [closePlanReview, onSelect, page, requestLeaveSettings, settingsTab],
  )

  useBackGesture()
  // Settings was a screen in the stack, and the back key left it. It is a page
  // now, so it has to claim its own level to keep doing that.
  useHistoryLevel(page === 'settings' && settingsHistoryClaimed, () => {
    void closeSettings().then((closed) => {
      if (closed || page !== 'settings') return
      // A popstate has already retired this history level. If the user keeps
      // editing, toggle the mirrored state so useHistoryLevel claims it again.
      setSettingsHistoryClaimed(false)
      requestAnimationFrame(() => setSettingsHistoryClaimed(true))
    })
  })
  useHistoryLevel(activeReviewId !== null, closePlanReview)

  const commandShortcut = platform === null ? 'Ctrl/⌘ K' : platform === 'macos' || platform === 'ios' ? '⌘ K' : 'Ctrl K'
  const createConversation = async (projectId?: string | null) => {
    const leavesSettings = page === 'settings'
    if (leavesSettings) {
      if (!(await requestLeaveSettings())) return
    }
    setActionError(null)
    try {
      closePlanReview()
      await onCreate(projectId)
      if (leavesSettings) clearSettingsTabDirty(settingsTab)
    } catch (error) {
      setActionError(t('sidebar.createConversationFailed', { error: String(error) }))
    }
  }

  return (
    <>
      <a
        data-slot="skip-link"
        href="#main-content"
        onClick={(event) => {
          // Browser-dev uses the hash as its playground route and reloads on a
          // hashchange. A skip link is an in-page focus move, not navigation.
          event.preventDefault()
          document.getElementById('main-content')?.focus({ preventScroll: true })
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-100 focus:rounded-md focus:bg-overlay focus:px-3 focus:py-2 focus:text-sm focus:text-overlay-foreground focus:shadow-overlay focus:outline-none focus:ring-2 focus:ring-focus"
      >
        {t('app.skipToContent')}
      </a>
      <Sidebar.Provider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        collapsible="icon"
        // Pro's provider is `min-h-svh`: a page that grows. This one is a fixed
        // viewport with its own scrollers inside, and the transcript's scroller
        // needs a container that does not move to measure against.
        className="h-svh overflow-hidden pb-[var(--ime-bottom,0px)]"
      >
        <AppSidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => void selectConversation(id)}
          onCreate={createConversation}
          onOpenSearch={() => setPaletteOpen(true)}
          onDelete={onDelete}
          page={page}
          onOpenSettings={() => {
            closePlanReview()
            onOpenSettings()
          }}
          onCloseSettings={() => void closeSettings()}
          settingsTab={settingsTab}
          onSettingsTabChange={(tab) => void changeSettingsTab(tab)}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={onSelectProject}
          onCreateProject={onCreateProject}
          onCreateHostedSession={onCreateHostedSession}
          onRename={onRename}
          onTogglePin={onTogglePin}
          onToggleArchive={onToggleArchive}
          onMoveToProject={onMoveToProject}
          onDeleteProject={onDeleteProject}
          onRenameProject={onRenameProject}
        />
        {!isMobile && sidebarOpen && (
          <div
            data-slot="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            tabIndex={-1}
            onDoubleClick={resetWidth}
            className="relative hidden md:block w-0.5 shrink-0 cursor-col-resize bg-transparent hover:bg-focus/30 active:bg-focus/50 transition-colors before:absolute before:inset-y-0 before:-left-1 before:w-3 before:content-['']"
            {...resizeHandleProps}
          />
        )}
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
            data-slot="app-header"
            className="flex items-center min-h-12 gap-2 px-4 pt-[var(--safe-top)] pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))] border-b border-border select-none shrink-0"
            data-tauri-drag-region={canDragWindow ? '' : undefined}
          >
            {/* Below 768px this is the only way to the conversation list, so it
              is sized for a thumb rather than for a pointer. */}
            <TooltipTrigger>
              <Sidebar.Trigger aria-label={t('sidebar.toggle')} className="-ml-1 size-11 md:size-8" />
              <Tooltip placement="bottom">{t('sidebar.toggle')}</Tooltip>
            </TooltipTrigger>
            <h1
              data-slot="app-title"
              ref={pageHeadingRef}
              tabIndex={-1}
              className="truncate rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus/50"
            >
              {headerTitle}
            </h1>
            {/* Beside the title rather than in the group of buttons on the right:
              it is not something to press, and it renders nothing at all while
              the connection is healthy — which on a desktop is always. */}
            <RemoteStatus />
            {/* The palette's other door. A phone has no `mod` key to press, and
              on a desktop a shortcut nobody has written down is a shortcut
              nobody uses — the tooltip is where it gets written down. */}
            {/* One `ml-auto`, on the group. Two auto margins split the free space
              between them and leave a gap in the middle of the pair. */}
            <div data-slot="app-header-actions" className="ml-auto flex shrink-0 items-center gap-1">
              {/* Only where the panel it toggles can open. */}
              {activeId && !isMobile && page !== 'settings' && !activeReviewId && (
                <TooltipTrigger>
                  <Button
                    iconOnly
                    variant={changesOpen ? 'secondary' : 'ghost'}
                    aria-label={t('chat.changes.toggle')}
                    aria-pressed={changesOpen}
                    onPress={() => setChangesOpen((open) => !open)}
                    className="size-11 md:size-8"
                  >
                    <FolderTree />
                  </Button>
                  <Tooltip placement="bottom">{t('chat.changes.toggle')}</Tooltip>
                </TooltipTrigger>
              )}
              <TooltipTrigger>
                <Button
                  iconOnly
                  variant="ghost"
                  aria-label={t('palette.title')}
                  aria-keyshortcuts="Meta+K Control+K"
                  onPress={() => setPaletteOpen(true)}
                  className="size-11 md:size-8"
                >
                  <Magnifier />
                </Button>
                <Tooltip placement="bottom">
                  {t('palette.title')}
                  <Kbd className="ml-2">{commandShortcut}</Kbd>
                </Tooltip>
              </TooltipTrigger>
            </div>
          </header>

          {actionError && (
            <div data-slot="app-action-error" className="shrink-0 border-b border-border px-4 py-2">
              <Alert status="danger" role="alert">
                <Alert.Indicator />
                <Alert.Content className="min-w-0">
                  <Alert.Description className="break-words">{actionError}</Alert.Description>
                </Alert.Content>
                <TooltipTrigger>
                  <Button
                    iconOnly
                    size="small"
                    variant="ghost"
                    aria-label={t('common.close')}
                    onPress={() => setActionError(null)}
                    className="touch-hitbox shrink-0"
                  >
                    <Xmark />
                  </Button>
                  <Tooltip placement="bottom">{t('common.close')}</Tooltip>
                </TooltipTrigger>
              </Alert>
            </div>
          )}

          {/* The conversation stays mounted under the settings page rather than
            being swapped out for it. Unmounting `ChatView` would take the draft
            in the composer and the transcript's scroll position with it, and
            coming back to a cleared composer reads as data loss.

            `inert` rather than `hidden`: the transcript's scroller measures
            itself every frame and watches intersections, and `display: none`
            collapses all of that to zero, so restoring it jumps back to the
            top. Inert keeps the layout exactly where it was while taking the
            subtree out of reach of focus and pointers. */}
          <main
            data-slot="app-main"
            id="main-content"
            tabIndex={-1}
            className="relative flex-1 min-h-0 overflow-hidden"
          >
            <div
              data-slot="app-chat-layer"
              className="flex h-full flex-col"
              inert={page === 'settings' || activeReviewId !== null || undefined}
            >
              {/* The split lives inside the chat branch, not around it: `<main>`
                is the positioned box the settings layer covers, and a group
                that enclosed both would have the settings page inside a panel
                it has no business being in. */}
              <Resizable orientation="horizontal" className="h-full min-h-0">
                <Resizable.Panel id="chat" minSize={35}>
                  {/* `min-w-0` or a flex child refuses to shrink, and the
                    transcript's `max-w-4xl mx-auto` overflows instead of
                    narrowing. */}
                  <div data-slot="app-chat-pane" className="flex h-full min-w-0 flex-col">
                    {activeId ? (
                      <ChatView
                        key={activeId}
                        conversationId={activeId}
                        initialDraft={pendingDraft}
                        onInitialDraftConsumed={onInitialDraftConsumed}
                        onCreate={createConversation}
                        onOpenSettingsTab={(tab) => {
                          void changeSettingsTab(tab).then((changed) => {
                            if (changed) onOpenSettings()
                          })
                        }}
                      />
                    ) : (
                      <EmptyState
                        onSubmit={onCreateWithDraft}
                        onCreate={onCreate}
                        onOpenSettingsTab={(tab) => {
                          void changeSettingsTab(tab).then((changed) => {
                            if (changed) onOpenSettings()
                          })
                        }}
                        activeProjectId={activeProjectId}
                      />
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
                  <SettingsPage activeTab={settingsTab} onOpenConversation={(id) => void selectConversation(id)} />
                </Suspense>
              </div>
            )}
            {activeReviewId && (
              <div data-slot="plan-review-layer" className="absolute inset-0 z-30 bg-surface">
                <Suspense fallback={null}>
                  <PlanReviewPage key={activeReviewId} reviewId={activeReviewId} onClose={closePlanReview} />
                </Suspense>
              </div>
            )}
          </main>
        </Sidebar.Main>

        {/* Outside `Sidebar.Main`, beside the palette: its region is `fixed`, and
          what it draws is about no particular pane. It sits above the settings
          layer by z-index, which is right — a conversation stopping on a
          permission prompt is not something being in settings should hide. */}
        <ApprovalToastRegion
          onSelect={(id) => void selectConversation(id)}
          transcriptInert={page === 'settings' || activeReviewId !== null}
        />

        <CommandPalette
          isOpen={paletteOpen}
          onOpenChange={setPaletteOpen}
          conversations={conversations}
          projects={projects}
          onSelectConversation={(id) => void selectConversation(id)}
          onSelectProject={onSelectProject}
          onOpenSettingsTab={(tab) => {
            closePlanReview()
            void changeSettingsTab(tab).then((changed) => {
              if (changed) onOpenSettings()
            })
          }}
          onCreate={createConversation}
        />
        {confirmDialog}
      </Sidebar.Provider>
    </>
  )
}
