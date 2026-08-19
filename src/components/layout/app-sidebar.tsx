/**
 * The sidebar, on HeroUI Pro's — a panel on a wide window, a sheet on a narrow
 * one, and the phone's conversation list either way.
 *
 * No row is given an `href`, and no `navigate` is configured. There is no URL
 * here to map a route onto: `lib/history-bridge.ts` writes a depth and nothing
 * else, deliberately, and an href without a `navigate` falls through to the
 * browser's own navigation — which under a custom protocol reloads the document
 * or trips the `hashchange` listener in `main.tsx`. `onAction` touches history
 * not at all, which is also what keeps the Android back key predictable.
 *
 * The consequence: `closeMobileOnAction` hangs off the href branch, and would
 * take `onAction` with it if we went there (Pro sets `onAction` to its own
 * dismiss handler when `href` is present, replacing ours). So the sheet is
 * closed by hand — see `dismissing` — and every row that navigates has to go
 * through it or the sheet stays open over the page it just opened.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { Button, Input } from '@heroui/react'
import { Sidebar, useSidebar } from '@heroui-pro/react/sidebar'
import { Archive, ArrowLeft, Comment, FolderOpen, FolderPlus, Gear, Pin, Plus } from '@gravity-ui/icons'

import { can } from '@/lib/capabilities'
import type { Conversation, Project } from '@/types'
import type { Page } from './shell-props'
// Not from the settings barrel: this is a value import, and the barrel would
// pull the whole lazily-loaded settings chunk into the main bundle.
import { visibleSettingsTabs, type SettingsTab } from '@/components/settings/tabs'
import { usePlatform } from '@/hooks/use-platform'
import { useHistoryLevel } from '@/hooks/use-history-level'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useConfirm } from '@/hooks/use-confirm'
import { ConversationIndicator } from './conversation-indicator'
import { ProjectIcon } from './project-icon'
import { RenameDialog } from './rename-dialog'
import { RowActionsMenu } from './row-actions-menu'
import { useConversationActions, useProjectActions, type RowAction } from './row-actions'

interface AppSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => void
  onTogglePin: (id: string) => void
  page: Page
  onOpenSettings: () => void
  onCloseSettings: () => void
  settingsTab: SettingsTab
  onSettingsTabChange: (tab: SettingsTab) => void
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => void
  onDeleteProject: (id: string) => void
  onRenameProject: (id: string, newName: string) => void
}

function NewProjectForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, path: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')

  const handleBrowse = useCallback(async () => {
    // Cancelling the picker rejects on Android instead of resolving to null.
    const selected = await open({ directory: true, multiple: false }).catch(() => null)
    if (selected) {
      setPath(selected)
      if (!name.trim()) {
        const parts = selected.replace(/\\/g, '/').split('/')
        setName(parts[parts.length - 1] || '')
      }
    }
  }, [name])

  return (
    <div className="px-2 py-1.5 space-y-1.5">
      <Input
        fullWidth
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('sidebar.projectName')}
        className="text-xs"
        autoFocus
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && name.trim() && path.trim()) onSubmit(name.trim(), path.trim())
          else if (e.key === 'Escape') onCancel()
        }}
      />
      {/* A project's working directory is read and written by the machine the
          backend is on, so browsing for it means browsing *that* filesystem —
          which the picker here cannot see. Typed instead, and said so: an
          address book of the wrong computer's folders would be worse than no
          picker at all. */}
      {can.browseForDirectory ? (
        <Button type="button" variant="outline" onClick={handleBrowse} className="w-full justify-start text-xs">
          <FolderOpen className="text-muted" />
          <span className={path ? 'text-foreground truncate' : 'text-muted'}>{path || t('sidebar.browsePath')}</span>
        </Button>
      ) : (
        <Input
          fullWidth
          type="text"
          aria-label={t('sidebar.hostPath')}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t('sidebar.hostPathPlaceholder')}
          className="text-xs"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && name.trim() && path.trim()) onSubmit(name.trim(), path.trim())
            else if (e.key === 'Escape') onCancel()
          }}
        />
      )}
      <div className="flex gap-1">
        <Button
          variant="secondary"
          onClick={() => name.trim() && path.trim() && onSubmit(name.trim(), path.trim())}
          isDisabled={!name.trim() || !path.trim()}
          className="flex-1"
        >
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          ✕
        </Button>
      </div>
    </div>
  )
}

/**
 * Where a rule is drawn above an entry, given the flat list `row-actions` hands
 * over. The phone renders the same actions as one ungrouped sheet, so this
 * belongs here rather than in the shared module.
 */
const GROUP_STARTS = new Set<RowAction['key']>(['export-sft', 'delete'])

/** Which list was right-clicked, in which copy of the sidebar, and on what row. */
interface MenuHit {
  scope: string
  kind: 'conversation' | 'project'
  id: string
}

/**
 * The conversations of each project, and the ones belonging to none.
 *
 * Grouping happens here rather than in SQL because the order inside each group
 * has to be the order the list arrived in — pinned first, then by recency — and
 * a second query per project would sort each one independently of the whole.
 */
function groupByProject(conversations: Conversation[]) {
  const filed = new Map<string, Conversation[]>()
  const loose: Conversation[] = []
  for (const conversation of conversations) {
    if (!conversation.project_id) {
      loose.push(conversation)
      continue
    }
    const existing = filed.get(conversation.project_id)
    if (existing) existing.push(conversation)
    else filed.set(conversation.project_id, [conversation])
  }
  return { filed, loose }
}

function RowActionItems({ actions }: { actions: RowAction[] }) {
  return (
    <>
      {actions.map((action, i) => (
        <Fragment key={action.key}>
          {i > 0 && GROUP_STARTS.has(action.key) && <ContextMenuSeparator />}
          <ContextMenuItem
            variant={action.variant === 'destructive' ? 'destructive' : undefined}
            disabled={Boolean(action.disabledReason)}
            onClick={() => void action.run()}
          >
            <action.icon />
            {action.label}
            {/* Beside the label rather than in a tooltip — see `RowAction`. */}
            {action.disabledReason && (
              <span className="ml-auto shrink-0 text-xs text-muted">{action.disabledReason}</span>
            )}
          </ContextMenuItem>
        </Fragment>
      ))}
    </>
  )
}

export function AppSidebar({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onTogglePin,
  page,
  onOpenSettings,
  onCloseSettings,
  settingsTab,
  onSettingsTabChange,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
}: AppSidebarProps) {
  const { t } = useTranslation()
  const platform = usePlatform()
  const { isMobileOpen, setMobileOpen } = useSidebar()
  const [showNewProject, setShowNewProject] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ type: 'conversation' | 'project'; id: string } | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  // The sheet is a level of its own, so the back key closes it before it
  // reaches whatever is behind. A no-op on a desktop, where the panel never
  // opens as a sheet in the first place.
  useHistoryLevel(isMobileOpen, () => setMobileOpen(false))

  /**
   * Wraps a row's action so that the mobile sheet gets out of the way.
   *
   * Everything that changes what fills the pane goes through this; the row
   * actions menu and the new-project form deliberately do not, because they put
   * their own surface up inside the sheet. Closing an already-closed sheet is a
   * no-op, which is every press on a wide window.
   */
  const dismissing = useCallback(
    <A extends unknown[]>(run: (...args: A) => void) =>
      (...args: A) => {
        setMobileOpen(false)
        run(...args)
      },
    [setMobileOpen],
  )

  const selectConversation = dismissing(onSelect)
  const selectProject = dismissing(onSelectProject)
  const createConversation = dismissing(onCreate)
  const openSettings = dismissing(onOpenSettings)
  const closeSettings = dismissing(onCloseSettings)
  const changeSettingsTab = dismissing(onSettingsTabChange)

  // One menu per list rather than one per row. A row cannot be the trigger:
  // `Sidebar.Menu` is a React Aria `Tree`, whose items pass only a fixed set of
  // DOM props through — `onContextMenu` is not among them — and anything
  // inserted between the tree and its items is not a collection item at all.
  // So the trigger wraps the whole list and the row is read back off the event,
  // which also leaves one popover behind where there used to be one per
  // conversation.
  //
  // `open` is controlled because a click that lands between rows has to be
  // refused, and the hit is a ref because that decision is taken inside
  // `onOpenChange`, which runs before a state update from the same event is
  // visible. The scope is part of it because the tree below is rendered twice —
  // once for the panel, once for the mobile sheet — and only the copy that was
  // right-clicked may open.
  const hitRef = useRef<MenuHit | null>(null)
  const [menu, setMenu] = useState<MenuHit | null>(null)

  const { filed, loose } = useMemo(() => groupByProject(conversations), [conversations])

  // Which projects are open, as bare project ids. The tree below is rendered
  // twice — once for the panel, once for the mobile sheet — under different key
  // prefixes, so what RAC hands back has to be translated on the way in and out
  // rather than stored as it comes.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())

  // Whatever is on screen has its project opened for it. A conversation reached
  // from anywhere but this list — the command palette, a notification — would
  // otherwise be current inside a branch nobody can see.
  const activeConversationProject = conversations.find((c) => c.id === activeId)?.project_id ?? null
  useEffect(() => {
    if (!activeConversationProject) return
    setExpanded((prev) => (prev.has(activeConversationProject) ? prev : new Set(prev).add(activeConversationProject)))
  }, [activeConversationProject])

  const conversationActions = useConversationActions({
    onTogglePin,
    onRequestRename: (id) => setRenameTarget({ type: 'conversation', id }),
    onRequestDelete: async (id) => {
      if (await confirm({ body: t('confirm.deleteConversation') })) onDelete(id)
    },
  })
  const projectActions = useProjectActions({
    onRequestRename: (id) => setRenameTarget({ type: 'project', id }),
    onRequestDelete: async (id) => {
      if (await confirm({ body: t('confirm.deleteProject') })) onDeleteProject(id)
    },
  })

  // Only the right-click menu needs to know which row was hit; the button on a
  // row already knows. Which *kind* of row it was is read off the DOM too:
  // projects and their conversations share one tree now, so the list a click
  // landed in no longer says what was clicked.
  const hitConversation = menu?.kind === 'conversation' ? conversations.find((c) => c.id === menu.id) : undefined
  const hitProject = menu?.kind === 'project' ? projects.find((p) => p.id === menu.id) : undefined
  const hitActions = hitConversation
    ? conversationActions(hitConversation)
    : hitProject
      ? projectActions(hitProject)
      : []

  // base-ui reads the cursor position off the Root, so the Root has to enclose
  // its own Trigger — a Root parked next to the dialogs at the bottom of this
  // component throws `ContextMenuRootContext is missing` at render, which
  // neither the type checker nor the build notices.
  const rowMenu = useCallback(
    (scope: string, actions: RowAction[], children: React.ReactNode) => (
      <ContextMenu open={menu?.scope === scope} onOpenChange={(open) => setMenu(open ? hitRef.current : null)}>
        <ContextMenuTrigger
          onContextMenu={(e: React.MouseEvent) => {
            const row = (e.target as HTMLElement).closest('[data-row-id]')
            const id = row?.getAttribute('data-row-id')
            const kind = row?.getAttribute('data-row-kind') as MenuHit['kind'] | null | undefined
            hitRef.current = id && kind ? { scope, kind, id } : null
          }}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <RowActionItems actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
    ),
    [menu],
  )

  const renaming =
    renameTarget?.type === 'project'
      ? projects.find((p) => p.id === renameTarget.id)?.name
      : (conversations.find((c) => c.id === renameTarget?.id)?.title ?? '')

  const settingsSide = (prefix: string) => (
    <>
      <Sidebar.Header>
        <Sidebar.Menu aria-label={t('settings.backToApp')}>
          <Sidebar.MenuItem id={`${prefix}back`} textValue={t('settings.backToApp')} onAction={closeSettings}>
            <Sidebar.MenuIcon>
              <ArrowLeft />
            </Sidebar.MenuIcon>
            <Sidebar.MenuLabel>{t('settings.backToApp')}</Sidebar.MenuLabel>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Header>

      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.GroupLabel>{t('settings.title')}</Sidebar.GroupLabel>
          <Sidebar.Menu aria-label={t('settings.title')}>
            {visibleSettingsTabs(platform).map((tab) => (
              <Sidebar.MenuItem
                key={tab.id}
                id={`${prefix}${tab.id}`}
                textValue={t(tab.labelKey)}
                isCurrent={settingsTab === tab.id}
                onAction={() => changeSettingsTab(tab.id)}
              >
                <Sidebar.MenuIcon>
                  <tab.icon />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{t(tab.labelKey)}</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
    </>
  )

  /**
   * One conversation, wherever it sits — nested under its project or loose in
   * the group below. The same row either way: its depth is the collection's
   * business, and Pro indents it off `aria-level` rather than off anything
   * written here.
   */
  const conversationItem = (prefix: string, conv: Conversation) => {
    const title = conv.title ?? t('sidebar.newChat')
    return (
      <Sidebar.MenuItem
        key={conv.id}
        id={`${prefix}conv-${conv.id}`}
        data-row-id={conv.id}
        data-row-kind="conversation"
        textValue={title}
        isCurrent={conv.id === activeId}
        onAction={() => selectConversation(conv.id)}
        className={conv.is_archived ? 'opacity-50' : undefined}
      >
        <Sidebar.MenuIcon>{conv.is_archived ? <Archive /> : <Comment />}</Sidebar.MenuIcon>
        <Sidebar.MenuLabel>{title}</Sidebar.MenuLabel>
        <Sidebar.MenuChip>
          {/* Pinned rows were sorted to the top and said nothing about why they
              were there. */}
          {conv.is_pinned === 1 && <Pin aria-label={t('contextMenu.pin')} className="size-3 text-muted" />}
          <ConversationIndicator conversationId={conv.id} activeId={activeId} />
        </Sidebar.MenuChip>
        <RowActionsMenu label={title} actions={conversationActions(conv)} />
      </Sidebar.MenuItem>
    )
  }

  const chatSide = (prefix: string) => (
    <>
      <Sidebar.Header>
        <Sidebar.Menu aria-label={t('sidebar.newChat')}>
          <Sidebar.MenuItem id={`${prefix}new`} textValue={t('sidebar.newChat')} onAction={createConversation}>
            <Sidebar.MenuIcon>
              <Plus />
            </Sidebar.MenuIcon>
            <Sidebar.MenuLabel>{t('sidebar.newChat')}</Sidebar.MenuLabel>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Header>

      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.GroupLabel>
            <span className="flex flex-1 items-center justify-between">
              {t('sidebar.projects')}
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={t('sidebar.newProject')}
                onClick={() => setShowNewProject(true)}
                className="size-6 rounded-md text-muted"
              >
                <FolderPlus />
              </Button>
            </span>
          </Sidebar.GroupLabel>
          {rowMenu(
            `${prefix}tree`,
            hitActions,
            <Sidebar.Menu
              // `project-tree` is ours, and only for the spacer rule in
              // `index.css` — see the note there.
              className="project-tree"
              aria-label={t('sidebar.projects')}
              expandedKeys={[...expanded].map((id) => `${prefix}project-${id}`)}
              onExpandedChange={(keys) =>
                setExpanded(new Set([...keys].map((key) => String(key).slice(`${prefix}project-`.length))))
              }
            >
              <Sidebar.MenuItem
                id={`${prefix}all-projects`}
                textValue={t('sidebar.allProjects')}
                isCurrent={activeProjectId === null}
                onAction={() => selectProject(null)}
              >
                <Sidebar.MenuIcon>
                  <FolderOpen />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{t('sidebar.allProjects')}</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
              {projects.map((project) => (
                <Sidebar.MenuItem
                  key={project.id}
                  id={`${prefix}project-${project.id}`}
                  data-row-id={project.id}
                  data-row-kind="project"
                  textValue={project.name}
                  isCurrent={project.id === activeProjectId}
                  onAction={() => selectProject(project.id)}
                >
                  {/* Before the icon, so the tree has one straight edge to read
                      down. It has to be a direct child of the item: Pro turns it
                      into the row's `slot="chevron"` button only here, and put
                      inside `MenuLabel` — as the docs' own first example does —
                      it renders as a bare, unclickable svg. */}
                  <Sidebar.MenuTrigger>
                    <Sidebar.MenuIndicator />
                  </Sidebar.MenuTrigger>
                  <Sidebar.MenuIcon>
                    <ProjectIcon sourceType={project.source_type} />
                  </Sidebar.MenuIcon>
                  <Sidebar.MenuLabel>{project.name}</Sidebar.MenuLabel>
                  <RowActionsMenu label={project.name} actions={projectActions(project)} />
                  {/* A marker, not an element: Pro lifts these out and renders
                      them as sibling rows one level deeper. So a conversation
                      row is never a DOM descendant of its project, which is what
                      keeps the `closest('[data-row-id]')` read above landing on
                      the row that was actually clicked. */}
                  <Sidebar.Submenu>
                    {(filed.get(project.id) ?? []).map((conv) => conversationItem(prefix, conv))}
                  </Sidebar.Submenu>
                </Sidebar.MenuItem>
              ))}
            </Sidebar.Menu>,
          )}
          {showNewProject && (
            <NewProjectForm
              onSubmit={(name, path) => {
                onCreateProject(name, path)
                setShowNewProject(false)
              }}
              onCancel={() => setShowNewProject(false)}
            />
          )}
        </Sidebar.Group>

        {/* What is left after the tree: the conversations that belong to no
            project. They keep a group of their own rather than a node of their
            own, because someone who has never made a project should not be
            asked to open one to reach their chats. */}
        {loose.length > 0 && (
          <Sidebar.Group>
            <Sidebar.GroupLabel>{t('sidebar.conversations')}</Sidebar.GroupLabel>
            {rowMenu(
              `${prefix}loose`,
              hitActions,
              <Sidebar.Menu aria-label={t('sidebar.conversations')}>
                {loose.map((conv) => conversationItem(prefix, conv))}
              </Sidebar.Menu>,
            )}
          </Sidebar.Group>
        )}
      </Sidebar.Content>

      <Sidebar.Footer>
        <Sidebar.Menu aria-label={t('sidebar.settings')}>
          <Sidebar.MenuItem id={`${prefix}settings`} textValue={t('sidebar.settings')} onAction={openSettings}>
            <Sidebar.MenuIcon>
              <Gear />
            </Sidebar.MenuIcon>
            <Sidebar.MenuLabel>{t('sidebar.settings')}</Sidebar.MenuLabel>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Footer>
    </>
  )

  // Keyed, so that switching pages remounts the panel instead of reconciling
  // it. Both sides open with a `Sidebar.Menu` holding a single item, and React
  // would keep that menu and hand it an item with a different id — which a
  // React Aria collection refuses outright ("Cannot change the id of an item"),
  // taking the whole screen down with it. The two sides share no state, so
  // there is nothing a remount costs.
  const side = (prefix: string) => (
    <Fragment key={page === 'settings' ? 'settings' : 'chat'}>
      {page === 'settings' ? settingsSide(prefix) : chatSide(prefix)}
    </Fragment>
  )

  return (
    <>
      {/* The safe-area padding sits on the panel rather than on its header and
          footer: `[data-state=collapsed] .sidebar__header` sets its own inline
          padding at a specificity a utility cannot reach, so a cutout would be
          honoured until the sidebar was collapsed and then quietly stop being. */}
      <Sidebar className="pt-[var(--safe-top)] pb-[var(--safe-bottom)] pl-[var(--safe-left)]">{side('d-')}</Sidebar>
      {/* Renders nothing above 768px. Below it Pro hides the panel outright, so
          without this a narrow window would have a toggle that toggles nothing.
          The sheet covers the full height including the cutout and the
          navigation bar, and it is a separate element from the panel above, so
          it needs its own copy of the insets rather than inheriting them. */}
      <Sidebar.Mobile className="pt-[var(--safe-top)] pb-[var(--safe-bottom)] pl-[var(--safe-left)]">
        {side('m-')}
      </Sidebar.Mobile>

      <RenameDialog
        isOpen={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        initialValue={renaming ?? ''}
        heading={t('contextMenu.rename')}
        onSubmit={(value) => {
          if (!renameTarget) return
          if (renameTarget.type === 'project') onRenameProject(renameTarget.id, value)
          else onRename(renameTarget.id, value)
        }}
      />

      {confirmDialog}
    </>
  )
}
