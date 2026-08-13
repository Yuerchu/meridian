import { Suspense, lazy, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@heroui/react'
import { Bars } from '@gravity-ui/icons'

import { ChatView } from '@/components/chat/chat-view'
import { EmptyState } from '@/components/chat/empty-state'
import { attachHistory } from '@/lib/history-bridge'
import { NavProvider, useNav, useStackNav } from '@/hooks/use-nav'
import { SettingsIndex } from '@/components/settings/settings-index'
import { settingsTabs, type SettingsTab } from '@/components/settings/tabs'
import { ConversationListPage } from './conversation-list-page'
import { MobileAppBar } from './mobile-app-bar'
import type { ShellProps } from './shell-props'

const SettingsPage = lazy(() => import('@/components/settings'))

/** The section's own name in the bar, rather than a generic "Settings". */
function settingsTabTitle(t: (key: string) => string, tab: SettingsTab): string {
  const def = settingsTabs.find((x) => x.id === tab)
  return def ? t(def.labelKey) : t('settings.title')
}

/**
 * The phone layout: one conversation, with everything else stacked over it.
 *
 * The conversation is always mounted. Screens above it are drawn as an opaque
 * layer rather than swapped in, because unmounting `ChatView` would take the
 * draft in the composer and the scroll position with it — the drawer this
 * replaces was an overlay, and losing that would read as a regression.
 *
 * `inert` rather than `hidden`: the transcript's scroller measures itself every
 * frame and watches intersections, and `display: none` collapses all of that to
 * zero, so restoring it jumps back to the top. Inert keeps the layout exactly
 * where it was while taking the subtree out of reach of focus and pointers.
 *
 * The root carries `--ime-bottom` because the soft keyboard is an application
 * concern; it lives on the sidebar's wrapper on the desktop only because that
 * wrapper happens to be the outermost element there.
 */
export function MobileShell(props: ShellProps) {
  const nav = useStackNav()

  useEffect(() => attachHistory(), [])

  return (
    <NavProvider value={nav}>
      <div className="flex h-svh w-full flex-col overflow-hidden pb-[var(--ime-bottom,0px)]">
        <Screens {...props} />
      </div>
    </NavProvider>
  )
}

function Screens(props: ShellProps) {
  const { t } = useTranslation()
  const nav = useNav()
  const {
    // No `settingsTab` here: which section is open is a position in the stack
    // on a phone, not a separate piece of state beside it.
    conversations, activeId, projects, activeProjectId,
    pendingMessage, headerTitle,
    onSelect, onCreate, onDelete, onRename, onTogglePin, onSelectProject,
    onDeleteProject, onRenameProject, onCreateWithMessage,
    onInitialMessageConsumed,
  } = props

  const covered = nav.canGoBack
  const top = nav.top

  return (
    <main className="relative flex-1 min-h-0 overflow-hidden">
      <div className="flex h-full flex-col" inert={covered || undefined}>
        {/* The list opens from the left, matching the desktop sidebar trigger.
            The right side is left free for actions on the conversation itself. */}
        <MobileAppBar
          title={headerTitle}
          backLabel={t('common.back')}
          leading={
            <Button
              isIconOnly
              variant="ghost"
              aria-label={t('sidebar.conversations')}
              onClick={() => nav.push({ name: 'conversations' })}
              className="size-12 shrink-0 rounded-xl"
            >
              <Bars className="size-5" />
            </Button>
          }
        />
        <div className="flex-1 min-h-0 overflow-hidden">
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
      </div>

      {covered && (
        <div data-slot="nav-overlay" className="absolute inset-0 z-20 bg-background">
          {top.name === 'conversations' ? (
            <ConversationListPage
              conversations={conversations}
              activeId={activeId}
              projects={projects}
              activeProjectId={activeProjectId}
              // Picking one returns to it rather than stacking another screen.
              onSelect={(id) => { onSelect(id); nav.popToRoot() }}
              onCreate={onCreate}
              onSelectProject={onSelectProject}
              onDelete={onDelete}
              onRename={onRename}
              onTogglePin={onTogglePin}
              onDeleteProject={onDeleteProject}
              onRenameProject={onRenameProject}
              onBack={nav.back}
              onOpenSettings={() => nav.push({ name: 'settings' })}
            />
          ) : top.name === 'settings' ? (
            <div className="flex h-full flex-col">
              <MobileAppBar
                title={t('settings.title')}
                backLabel={t('common.back')}
                onBack={nav.back}
              />
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[max(1rem,var(--safe-bottom))]">
                <SettingsIndex onSelect={(tab) => nav.push({ name: 'settingsTab', tab })} />
              </div>
            </div>
          ) : top.name === 'settingsTab' ? (
            <div className="flex h-full flex-col">
              <MobileAppBar
                title={settingsTabTitle(t, top.tab)}
                backLabel={t('common.back')}
                onBack={nav.back}
              />
              <div className="flex-1 min-h-0 overflow-hidden">
                <Suspense fallback={null}>
                  <SettingsPage activeTab={top.tab} />
                </Suspense>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </main>
  )
}
