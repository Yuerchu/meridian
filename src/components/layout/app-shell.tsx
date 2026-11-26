import './app-shell.css'
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Kbd } from '@/components/yuerchu-ui/components/kbd/kbd'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { ToastRegion } from '@/components/yuerchu-ui/components/toast/toast'
import { ResizablePanels } from '@/components/yuerchu-ui/components/resizable-panels/resizable-panels'
import { AppShell as LibraryAppShell } from '@/components/yuerchu-ui/templates/app-shell/app-shell'
import { FolderTree, Menu, Search } from '@keyline-icons/react/two-tone'
import { ChangesPanel } from '@/components/chat/changes-panel'
import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
import { clearSettingsTabDirty, useSettingsTabDirty } from '@/components/settings/dirty-guard'
import { useConfirm } from '@/hooks/use-confirm'
import { useBackGesture, useHistoryLevel } from '@/hooks/use-history-level'
import { useHotkey } from '@/hooks/use-hotkey'
import { useLaunchRequest } from '@/hooks/use-launch-request'
import { useIsMobile } from '@/hooks/use-mobile'
import { usePlatform } from '@/hooks/use-platform'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import { usePlanReviewNavigation } from '@/components/plan-review/navigation'
import { ApprovalNotifications } from './approval-notifications'
import { AppSidebar } from './app-sidebar'
import { CHANGES_SPLIT } from './changes-split'
import { CommandPalette } from './command-palette'
import { NotificationInbox } from './notification-inbox'
import { RemoteStatus } from './remote-status'
import type { ShellProps } from './shell-props'
import { titleIfTruncated } from '@/lib/truncation'

const SettingsPage = lazy(() => import('@/components/settings'))
const BoardPage = lazy(() => import('@/components/board/board-page').then((module) => ({ default: module.BoardPage })))
const StudioPage = lazy(() => import('@/components/studio').then((module) => ({ default: module.StudioPage })))
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
 * 768px and as a sheet below it — Sidebar renders both from the same tree — and
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
    onOpenBoard,
    onCloseBoard,
    onOpenStudio,
    onCloseStudio,
    onSettingsTabChange,
    onCreateWithDraft,
    onInitialDraftConsumed,
  } = props

  // Controlled on purpose. Left uncontrolled, the old provider wrote the state
  // to a `sidebar_state` cookie on every toggle — a Next.js convention, useless
  // here (nothing reads it back) and one more thing to have an opinion about
  // under a custom protocol. Persisting the state is a store field if we ever
  // want it.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [inboxOpen, setInboxOpen] = useState(false)
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
  // Every way out of a plan review asks it first: it may hold a draft whose
  // save failed. Also owns the review's back-gesture level and focus return.
  const leavePlanReview = usePlanReviewNavigation()

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
  // Nothing to list without a conversation, and no room to list it in below
  // `md` — the panel would leave the transcript a column too narrow to read.
  // Unmounted rather than hidden with a class: a hidden panel still builds the
  // tree and subscribes to the session.
  const showChanges = changesOpen && activeId !== null && !isMobile

  const requestLeaveSettings = useCallback(async () => {
    if (!settingsDirty) return true
    return confirm({ description: t('settings.unsavedChanges'), confirmLabel: t('common.discardChanges') })
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
      if (!(await leavePlanReview())) return false
      if (page === 'settings') {
        if (!(await requestLeaveSettings())) return false
        clearSettingsTabDirty(settingsTab)
      }
      onSelect(id)
      return true
    },
    [leavePlanReview, onSelect, page, requestLeaveSettings, settingsTab],
  )

  useBackGesture()
  // The keyboard toolbar's settings button launches the app asking for this page.
  useLaunchRequest((tab) => {
    void leavePlanReview().then((left) => {
      if (!left) return
      void changeSettingsTab(tab).then((changed) => {
        if (changed) onOpenSettings()
      })
    })
  })
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

  // The board is a page beside the chat, as settings is: the back gesture
  // leaves it, and reaching it from settings asks about unsaved work first.
  useHistoryLevel(page === 'board', onCloseBoard)
  useHistoryLevel(page === 'studio', onCloseStudio)

  // Mobile drawer: back gesture closes it before leaving the app.
  useHistoryLevel(drawerOpen, () => setDrawerOpen(false))

  const openBoard = async () => {
    if (!(await leavePlanReview())) return
    if (page === 'settings') {
      if (!(await requestLeaveSettings())) return
      clearSettingsTabDirty(settingsTab)
    }
    onOpenBoard()
  }

  const openStudio = async () => {
    if (!(await leavePlanReview())) return
    if (page === 'settings') {
      if (!(await requestLeaveSettings())) return
      clearSettingsTabDirty(settingsTab)
    }
    onOpenStudio()
  }

  const commandShortcut =
    platform === null ? ['Ctrl/⌘', 'K'] : platform === 'macos' || platform === 'ios' ? ['⌘', 'K'] : ['Ctrl', 'K']
  const createConversation = async (projectId?: string | null) => {
    if (!(await leavePlanReview())) return
    const leavesSettings = page === 'settings'
    if (leavesSettings) {
      if (!(await requestLeaveSettings())) return
    }
    setActionError(null)
    try {
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
        className="m-app-frame__skip-link"
      >
        {t('app.skipToContent')}
      </a>
      <div className="m-app-frame">
        <LibraryAppShell
          embedded
          variant="inset"
          brand={null}
          sidebarLabel={t('sidebar.label')}
          isCollapsible
          isCollapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          showMobileBar={false}
          isDrawerOpen={drawerOpen}
          onDrawerOpenChange={setDrawerOpen}
          navigation={
            <AppSidebar
              conversations={conversations}
              activeId={activeId}
              onSelect={(id) => void selectConversation(id)}
              onCreate={createConversation}
              onOpenSearch={() => setPaletteOpen(true)}
              onDelete={onDelete}
              page={page}
              onOpenBoard={() => void openBoard()}
              onOpenStudio={() => void openStudio()}
              onOpenSettings={() => {
                void leavePlanReview().then((left) => {
                  if (left) onOpenSettings()
                })
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
              isCollapsed={sidebarCollapsed}
              isDrawerOpen={drawerOpen}
              onDrawerOpenChange={setDrawerOpen}
            />
          }
        >
          <div className="m-app-frame__stage">
            <header
              data-slot="app-header"
              className="m-app-frame__header"
              data-tauri-drag-region={canDragWindow ? '' : undefined}
            >
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Menu />}
                  aria-label={t('sidebar.toggle')}
                  aria-expanded={drawerOpen}
                  onPress={() => setDrawerOpen(!drawerOpen)}
                  className="m-app-frame__drawer-toggle"
                />
                <Tooltip placement="bottom">{t('sidebar.toggle')}</Tooltip>
              </TooltipTrigger>
              <h1
                data-slot="app-title"
                onPointerEnter={titleIfTruncated}
                ref={pageHeadingRef}
                tabIndex={-1}
                className="m-app-frame__title"
              >
                {headerTitle}
              </h1>
              <RemoteStatus />
              <div data-slot="app-header-actions" className="m-app-frame__actions">
                {/* Only where the panel it toggles can open. */}
                {activeId && !isMobile && page === 'chat' && !activeReviewId && (
                  <TooltipTrigger>
                    <Button
                      icon={<FolderTree />}
                      size="sm"
                      variant="ghost"
                      aria-label={t('chat.changes.toggle')}
                      // The library has no icon-only toggle yet (Yuerchu/ui#565): the
                      // state reaches assistive technology, not the screen.
                      aria-pressed={changesOpen}
                      onPress={() => setChangesOpen((open) => !open)}
                    />
                    <Tooltip placement="bottom">{t('chat.changes.toggle')}</Tooltip>
                  </TooltipTrigger>
                )}
                <TooltipTrigger>
                  <Button
                    icon={<Search />}
                    size="sm"
                    variant="ghost"
                    aria-label={t('palette.title')}
                    aria-keyshortcuts="Meta+K Control+K"
                    onPress={() => setPaletteOpen(true)}
                  />
                  <Tooltip placement="bottom">
                    {t('palette.title')}
                    <span className="m-app-shell__shortcut">
                      <Kbd keys={commandShortcut} />
                    </span>
                  </Tooltip>
                </TooltipTrigger>
                {/* Rightmost, and in the header rather than the sidebar so it is
                there with the sidebar collapsed. The floating stack shows the
                front of the same queue; this is all of it. */}
                <NotificationInbox
                  onSelect={selectConversation}
                  onOpenSettingsTab={(tab) => {
                    void changeSettingsTab(tab).then((changed) => {
                      if (changed) onOpenSettings()
                    })
                  }}
                  transcriptInert={page !== 'chat' || activeReviewId !== null}
                  boardOpen={page === 'board'}
                  isOpen={inboxOpen}
                  onOpenChange={setInboxOpen}
                />
              </div>
            </header>
            {actionError && (
              <div data-slot="app-action-error" className="m-app-frame__action-error">
                <Alert tone="danger" shouldAnnounce onDismiss={() => setActionError(null)}>
                  {actionError}
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
            <main data-slot="app-main" id="main-content" tabIndex={-1} className="m-app-frame__main">
              <div
                data-slot="app-chat-layer"
                className="m-app-frame__chat-layer"
                inert={page !== 'chat' || activeReviewId !== null || undefined}
              >
                {/* The split lives inside the chat branch, not around it: `<main>`
                is the positioned box the settings layer covers, and a group
                that enclosed both would have the settings page inside a panel
                it has no business being in. */}
                {(() => {
                  const chatPane = (
                    <div data-slot="app-chat-pane" className="m-app-frame__chat-pane">
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
                  )
                  return showChanges && activeId ? (
                    <ResizablePanels
                      orientation="horizontal"
                      {...CHANGES_SPLIT}
                      aria-label={t('chat.changes.title')}
                      className="m-app-frame__split"
                    >
                      {[
                        chatPane,
                        <ChangesPanel key="changes" conversationId={activeId} onClose={() => setChangesOpen(false)} />,
                      ]}
                    </ResizablePanels>
                  ) : (
                    chatPane
                  )
                })()}
              </div>

              {/* Full-bleed `--background` layer over the inset chat frame. */}
              {page === 'settings' && (
                <div data-slot="settings-layer" className="m-app-layer">
                  {/* No spinner: the chunk is on local disk and resolves within a
                  frame or two, where a flash of "loading" would read as jank. */}
                  <Suspense fallback={null}>
                    {/* `onSelect` is the existing navigation boundary: it changes
                    the active conversation and closes settings in one action. */}
                    <SettingsPage activeTab={settingsTab} onOpenConversation={(id) => void selectConversation(id)} />
                  </Suspense>
                </div>
              )}
              {page === 'board' && (
                <div data-slot="board-layer" className="m-app-layer">
                  <Suspense fallback={null}>
                    {/* Opening a card's conversation is the ordinary navigation:
                    it selects the conversation and leaves the board. */}
                    <BoardPage onOpenConversation={(id) => void selectConversation(id)} />
                  </Suspense>
                </div>
              )}
              {page === 'studio' && (
                <div data-slot="studio-layer" className="m-app-layer">
                  <Suspense fallback={null}>
                    <StudioPage
                      onOpenModelsSettings={() => {
                        void changeSettingsTab('models').then((changed) => {
                          if (changed) onOpenSettings()
                        })
                      }}
                    />
                  </Suspense>
                </div>
              )}
              {activeReviewId && (
                <div data-slot="plan-review-layer" className="m-app-layer" data-front>
                  <Suspense fallback={null}>
                    <PlanReviewPage
                      key={activeReviewId}
                      reviewId={activeReviewId}
                      onClose={() => void leavePlanReview()}
                    />
                  </Suspense>
                </div>
              )}
            </main>
          </div>

          {/* Outside `Sidebar.Main`, beside the palette: its viewport is portalled and `fixed`, and
          what it draws is about no particular pane. It sits above the settings
          layer by z-index, which is right — a conversation stopping on a
          permission prompt is not something being in settings should hide. */}
          <ApprovalNotifications
            onSelect={selectConversation}
            transcriptInert={page !== 'chat' || activeReviewId !== null}
            boardOpen={page === 'board'}
            inboxOpen={inboxOpen}
          />
          {/* The library's Toast region: the undo offer is the first thing to use it. */}
          <ToastRegion />

          <CommandPalette
            isOpen={paletteOpen}
            onOpenChange={setPaletteOpen}
            conversations={conversations}
            projects={projects}
            onSelectConversation={(id) => void selectConversation(id)}
            onSelectProject={onSelectProject}
            onOpenSettingsTab={(tab) => {
              void leavePlanReview().then((left) => {
                if (!left) return
                void changeSettingsTab(tab).then((changed) => {
                  if (changed) onOpenSettings()
                })
              })
            }}
            onCreate={createConversation}
          />
          {confirmDialog}
        </LibraryAppShell>
      </div>
    </>
  )
}
