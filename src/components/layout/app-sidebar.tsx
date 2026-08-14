/**
 * The desktop sidebar, on HeroUI Pro's.
 *
 * No row is given an `href`, and no `navigate` is configured. There is no URL
 * here to map a route onto: `lib/history-bridge.ts` writes a depth and nothing
 * else, deliberately, and an href without a `navigate` falls through to the
 * browser's own navigation — which under a custom protocol reloads the document
 * or trips the `hashchange` listener in `main.tsx`. `onAction` touches history
 * not at all, which is also what keeps the Android back key predictable.
 *
 * The consequence to know about: `closeMobileOnAction` hangs off the href
 * branch, so it is unreachable from here. It costs nothing today — the phone
 * runs `ConversationListPage`, not this — but a mobile sheet that stays open
 * after a tap is where to look first.
 */
import { Fragment, useCallback, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { AlertDialog, Button, Input } from '@heroui/react'
import { Sidebar } from '@heroui-pro/react/sidebar'
import { Archive, ArrowLeft, Comment, FolderOpen, FolderPlus, Gear, Plus } from '@gravity-ui/icons'

import type { Conversation, Project } from '@/types'
import type { Page } from '@/lib/nav'
// Not from the settings barrel: this is a value import, and the barrel would
// pull the whole lazily-loaded settings chunk into the main bundle.
import { visibleSettingsTabs, type SettingsTab } from '@/components/settings/tabs'
import { usePlatform } from '@/hooks/use-platform'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ConversationIndicator } from './conversation-indicator'
import { ProjectIcon } from './project-icon'
import { RenameDialog } from './rename-dialog'
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

function NewProjectForm({ onSubmit, onCancel }: { onSubmit: (name: string, path: string) => void; onCancel: () => void }) {
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
      <Input fullWidth
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
      <Button
        type="button"
        variant="outline"
        onClick={handleBrowse}
        className="w-full justify-start text-xs"
      >
        <FolderOpen className="text-muted" />
        <span className={path ? 'text-foreground truncate' : 'text-muted'}>
          {path || t('sidebar.browsePath')}
        </span>
      </Button>
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

function RowActionItems({ actions }: { actions: RowAction[] }) {
  return (
    <>
      {actions.map((action, i) => (
        <Fragment key={action.key}>
          {i > 0 && GROUP_STARTS.has(action.key) && <ContextMenuSeparator />}
          <ContextMenuItem
            variant={action.variant === 'destructive' ? 'destructive' : undefined}
            onClick={() => void action.run()}
          >
            <action.icon />
            {action.label}
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
  const [showNewProject, setShowNewProject] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ type: 'conversation' | 'project'; id: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'conversation' | 'project'; id: string } | null>(null)
  // `AlertDialog.Body` is a plain div — only a `Heading slot="title"` is wired
  // up for us, so without this the dialog announces its title and nothing else.
  const deleteDescId = useId()

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

  const conversationActions = useConversationActions({
    conversation: (menu?.kind === 'conversation' && conversations.find((c) => c.id === menu.id)) || null,
    onTogglePin,
    onRequestRename: (id) => setRenameTarget({ type: 'conversation', id }),
    onRequestDelete: (id) => setDeleteTarget({ type: 'conversation', id }),
  })
  const projectActions = useProjectActions({
    project: (menu?.kind === 'project' && projects.find((p) => p.id === menu.id)) || null,
    onRequestRename: (id) => setRenameTarget({ type: 'project', id }),
    onRequestDelete: (id) => setDeleteTarget({ type: 'project', id }),
  })

  // base-ui reads the cursor position off the Root, so the Root has to enclose
  // its own Trigger — a Root parked next to the dialogs at the bottom of this
  // component throws `ContextMenuRootContext is missing` at render, which
  // neither the type checker nor the build notices.
  const rowMenu = useCallback((
    scope: string,
    kind: MenuHit['kind'],
    actions: RowAction[],
    children: React.ReactNode,
  ) => (
    <ContextMenu
      open={menu?.scope === scope && menu.kind === kind}
      onOpenChange={(open) => setMenu(open ? hitRef.current : null)}
    >
      <ContextMenuTrigger
        onContextMenu={(e: React.MouseEvent) => {
          const id = (e.target as HTMLElement).closest('[data-row-id]')?.getAttribute('data-row-id')
          hitRef.current = id ? { scope, kind, id } : null
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <RowActionItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  ), [menu])

  const renaming = renameTarget?.type === 'project'
    ? projects.find((p) => p.id === renameTarget.id)?.name
    : conversations.find((c) => c.id === renameTarget?.id)?.title ?? ''

  const settingsSide = (prefix: string) => (
    <>
      <Sidebar.Header>
        <Sidebar.Menu aria-label={t('settings.backToApp')}>
          <Sidebar.MenuItem id={`${prefix}back`} textValue={t('settings.backToApp')} onAction={onCloseSettings}>
            <Sidebar.MenuIcon><ArrowLeft /></Sidebar.MenuIcon>
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
                onAction={() => onSettingsTabChange(tab.id)}
              >
                <Sidebar.MenuIcon><tab.icon /></Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{t(tab.labelKey)}</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
    </>
  )

  const chatSide = (prefix: string) => (
    <>
      <Sidebar.Header>
        <Sidebar.Menu aria-label={t('sidebar.newChat')}>
          <Sidebar.MenuItem id={`${prefix}new`} textValue={t('sidebar.newChat')} onAction={onCreate}>
            <Sidebar.MenuIcon><Plus /></Sidebar.MenuIcon>
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
          {rowMenu(prefix, 'project', projectActions, (
            <Sidebar.Menu aria-label={t('sidebar.projects')}>
              <Sidebar.MenuItem
                id={`${prefix}all-projects`}
                textValue={t('sidebar.allProjects')}
                isCurrent={activeProjectId === null}
                onAction={() => onSelectProject(null)}
              >
                <Sidebar.MenuIcon><FolderOpen /></Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{t('sidebar.allProjects')}</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
              {projects.map((project) => (
                <Sidebar.MenuItem
                  key={project.id}
                  id={`${prefix}project-${project.id}`}
                  data-row-id={project.id}
                  textValue={project.name}
                  isCurrent={project.id === activeProjectId}
                  onAction={() => onSelectProject(project.id)}
                >
                  <Sidebar.MenuIcon><ProjectIcon sourceType={project.source_type} /></Sidebar.MenuIcon>
                  <Sidebar.MenuLabel>{project.name}</Sidebar.MenuLabel>
                </Sidebar.MenuItem>
              ))}
            </Sidebar.Menu>
          ))}
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

        <Sidebar.Group>
          <Sidebar.GroupLabel>{t('sidebar.conversations')}</Sidebar.GroupLabel>
          {rowMenu(prefix, 'conversation', conversationActions, (
            <Sidebar.Menu aria-label={t('sidebar.conversations')}>
              {conversations.map((conv) => (
                <Sidebar.MenuItem
                  key={conv.id}
                  id={`${prefix}conv-${conv.id}`}
                  data-row-id={conv.id}
                  textValue={conv.title ?? t('sidebar.newChat')}
                  isCurrent={conv.id === activeId}
                  onAction={() => onSelect(conv.id)}
                  className={conv.is_archived ? 'opacity-50' : undefined}
                >
                  <Sidebar.MenuIcon>{conv.is_archived ? <Archive /> : <Comment />}</Sidebar.MenuIcon>
                  <Sidebar.MenuLabel>{conv.title ?? t('sidebar.newChat')}</Sidebar.MenuLabel>
                  <Sidebar.MenuChip>
                    <ConversationIndicator conversationId={conv.id} activeId={activeId} />
                  </Sidebar.MenuChip>
                </Sidebar.MenuItem>
              ))}
            </Sidebar.Menu>
          ))}
        </Sidebar.Group>
      </Sidebar.Content>

      <Sidebar.Footer>
        <Sidebar.Menu aria-label={t('sidebar.settings')}>
          <Sidebar.MenuItem id={`${prefix}settings`} textValue={t('sidebar.settings')} onAction={onOpenSettings}>
            <Sidebar.MenuIcon><Gear /></Sidebar.MenuIcon>
            <Sidebar.MenuLabel>{t('sidebar.settings')}</Sidebar.MenuLabel>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Footer>
    </>
  )

  const side = page === 'settings' ? settingsSide : chatSide

  return (
    <>
      {/* The safe-area padding sits on the panel rather than on its header and
          footer: `[data-state=collapsed] .sidebar__header` sets its own inline
          padding at a specificity a utility cannot reach, so a cutout would be
          honoured until the sidebar was collapsed and then quietly stop being. */}
      <Sidebar className="pt-[var(--safe-top)] pb-[var(--safe-bottom)] pl-[var(--safe-left)]">
        {side('d-')}
      </Sidebar>
      {/* Renders nothing above 768px. Below it Pro hides the panel outright, so
          without this a narrow window would have a toggle that toggles nothing. */}
      <Sidebar.Mobile>{side('m-')}</Sidebar.Mobile>

      <RenameDialog
        isOpen={renameTarget !== null}
        onOpenChange={(open) => { if (!open) setRenameTarget(null) }}
        initialValue={renaming ?? ''}
        heading={t('contextMenu.rename')}
        onSubmit={(value) => {
          if (!renameTarget) return
          if (renameTarget.type === 'project') onRenameProject(renameTarget.id, value)
          else onRename(renameTarget.id, value)
        }}
      />

      <AlertDialog.Backdrop
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog aria-describedby={deleteDescId}>
            <AlertDialog.Header>
              <AlertDialog.Heading>{t('confirm.title')}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body id={deleteDescId}>
              {deleteTarget?.type === 'project' ? t('confirm.deleteProject') : t('confirm.deleteConversation')}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                {t('common.cancel')}
              </Button>
              <Button
                slot="close"
                variant="danger"
                onClick={() => {
                  if (deleteTarget?.type === 'conversation') onDelete(deleteTarget.id)
                  else if (deleteTarget?.type === 'project') onDeleteProject(deleteTarget.id)
                }}
              >
                {t('common.confirm')}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}
