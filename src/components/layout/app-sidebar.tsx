/**
 * The sidebar navigation, built on Yuerchu UI's `NavList`, `NavGroup`,
 * `NavSection`, and `NavItem` inside `AppShell`'s `Sidebar`.
 *
 * Each project (and the unfiled loose group) renders as a cascading `NavGroup`
 * wrapped in a React Aria `DropZone` so conversations can be dragged between
 * groups or into the chat column as citations. No item carries an `href`:
 * `lib/history-bridge.ts` manages back-gesture depth without URL routes, so
 * every item activates through `onPress`.
 */
import './app-sidebar.css'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDrag } from 'react-aria'
import { DropZone } from 'react-aria-components'
import type { DropItem } from 'react-aria-components'
import { open } from '@tauri-apps/plugin-dialog'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Kbd } from '@/components/yuerchu-ui/components/kbd/kbd'
import { Menu, MenuItem, MenuTrigger } from '@/components/yuerchu-ui/components/menu/menu'
import {
  NavCollapsedContext,
  NavGroup,
  NavigateContext,
  NavItem,
  NavList,
  NavSection,
} from '@/components/yuerchu-ui/components/nav-list/nav-list'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import {
  Archive,
  ArrowInDownDashedPanel,
  ArrowLeft,
  Bookmark,
  FolderOpen,
  FolderPlus,
  GitPullRequest,
  LayoutDashboard,
  MoreVertical,
  Plus,
  Search,
  Settings,
  Terminal,
  X,
} from '@keyline-icons/react/two-tone'
import { ConversationIcon } from '@/components/ui/agent-icon'
import { ClaudeSessionPicker } from './claude-session-picker'

import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { isRemote } from '@/lib/transport'
import type { ConversationInfoResponse, ProjectInfoResponse } from '@/types'
import type { Page } from './shell-props'
// Not from the settings barrel: this is a value import, and the barrel would
// pull the whole lazily-loaded settings chunk into the main bundle.
import { visibleSettingsTabGroups, type SettingsTab } from '@/components/settings/tabs'
import { usePlatform } from '@/hooks/use-platform'
import { useConfirm } from '@/hooks/use-confirm'
import { useConversationStore } from '@/stores/conversation-store'
import { useUndoStore } from '@/stores/undo-store'
import { isCoarsePointer } from '@/hooks/use-coarse-pointer'
import { ConversationIndicator } from './conversation-indicator'
import { MoveDialog } from './move-dialog'
import { acceptsConversationDrop, CONVERSATION_DRAG_TYPE } from './sidebar-dnd'
import { RenameDialog } from './rename-dialog'
import { RowActionDropdownItems, RowActionsMenu } from './row-actions-menu'
import { ConversationTime, ConversationTimeSection } from './conversation-time'
import { useConversationActions, useProjectActions, type RowAction } from './row-actions'
import { titleIfTruncated } from '@/lib/truncation'

interface AppSidebarProps {
  conversations: ConversationInfoResponse[]
  activeId: string | null
  onSelect: (id: string) => void
  /** Start a conversation — under `projectId` when given, under the active
   *  project when omitted, loose when `null`. */
  onCreate: (projectId?: string | null) => void | Promise<void>
  /** Open the command palette — the sidebar's search row is its second door. */
  onOpenSearch: () => void
  /** These four and the two project ones reject when the backend refuses; the
   *  sidebar says so in its footer rather than leaving the click unanswered. */
  onDelete: (id: string) => Promise<void>
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
  /** Refile a conversation under another project, or under none (`null`). */
  onMoveToProject: (id: string, projectId: string | null) => Promise<string | null>
  page: Page
  onOpenBoard: () => void
  onOpenSettings: () => void
  onCloseSettings: () => void
  settingsTab: SettingsTab
  onSettingsTabChange: (tab: SettingsTab) => void
  projects: ProjectInfoResponse[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => void | Promise<void>
  onDeleteProject: (id: string) => Promise<void>
  onRenameProject: (id: string, newName: string) => Promise<void>
  /** Start a hosted Claude Code session in `cwd`. Resolves to the reason it
   *  failed, or `null`. Desktop only. */
  onCreateHostedSession: (cwd: string) => Promise<string | null>
  /** Whether the desktop sidebar is collapsed to an icon rail. */
  isCollapsed?: boolean
  /** Called when the desktop sidebar collapse state changes. */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Whether the mobile drawer is open. */
  isDrawerOpen?: boolean
  /** Called when the mobile drawer open state changes. */
  onDrawerOpenChange?: (open: boolean) => void
}

/**
 * The draft, held at the sidebar root so crossing the responsive breakpoint
 * (desktop panel <-> mobile drawer) never discards an in-progress form.
 */
function useDraft(): {
  name: string
  path: string
  setName: (v: string) => void
  setPath: (v: string) => void
  reset: () => void
} {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const reset = useCallback(() => {
    setName('')
    setPath('')
  }, [])
  return { name, path, setName, setPath, reset }
}

function useProjectCreation(): {
  saving: boolean
  error: string | null
  setSaving: (value: boolean) => void
  setError: (value: string | null) => void
  reset: () => void
} {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reset = useCallback(() => {
    setSaving(false)
    setError(null)
  }, [])
  return { saving, error, setSaving, setError, reset }
}

function useHostedLaunch(): {
  starting: boolean
  error: string | null
  setStarting: (v: boolean) => void
  setError: (v: string | null) => void
  reset: () => void
} {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reset = useCallback(() => {
    setStarting(false)
    setError(null)
  }, [])
  return { starting, error, setStarting, setError, reset }
}

function NewProjectForm({
  draft,
  creation,
  onSubmit,
  onCancel,
}: {
  draft: ReturnType<typeof useDraft>
  creation: ReturnType<typeof useProjectCreation>
  onSubmit: (name: string, path: string) => void | Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { name, path, setName, setPath } = draft
  const { saving, error, setSaving, setError } = creation

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
  }, [name, setName, setPath])

  const submit = async () => {
    const nextName = name.trim()
    const nextPath = path.trim()
    if (!nextName || !nextPath || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit(nextName, nextPath)
    } catch (submitError) {
      setError(t('sidebar.createProjectFailed', { error: String(submitError) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-slot="project-form" className="m-sidebar__form">
      <TextField
        aria-label={t('sidebar.projectName')}
        value={name}
        onChange={(e) => setName(e)}
        placeholder={t('sidebar.projectName')}
        autoFocus
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') void submit()
          else if (e.key === 'Escape') onCancel()
        }}
      />
      {/* A project's working directory is read and written by the machine the
          backend is on, so browsing for it means browsing *that* filesystem —
          which the picker here cannot see. Typed instead, and said so: an
          address book of the wrong computer's folders would be worse than no
          picker at all. */}
      {can.browseForDirectory ? (
        <Button
          icon={<FolderOpen />}
          type="button"
          size="sm"
          variant="secondary"
          onPress={() => void handleBrowse()}
          isDisabled={saving}
          className="m-sidebar__form-browse"
        >
          <span
            data-slot="project-form-path"
            onPointerEnter={titleIfTruncated}
            className="m-sidebar__form-path"
            data-empty={!path || undefined}
          >
            {path || t('sidebar.browsePath')}
          </span>
        </Button>
      ) : (
        <TextField
          aria-label={t('sidebar.hostPath')}
          value={path}
          onChange={(e) => setPath(e)}
          placeholder={t('sidebar.hostPathPlaceholder')}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') void submit()
            else if (e.key === 'Escape') onCancel()
          }}
        />
      )}
      {error && (
        <p data-slot="project-form-error" role="alert" className="m-sidebar__form-error">
          {error}
        </p>
      )}
      <div data-slot="project-form-actions" className="m-sidebar__form-actions">
        <Button
          variant="secondary"
          size="sm"
          aria-busy={saving}
          onPress={() => void submit()}
          isDisabled={!name.trim() || !path.trim()}
          isPending={saving}
          className="m-sidebar__form-submit"
        >
          {t('common.save')}
        </Button>
        {/* The glyph is not a name: a screen reader reads U+2715 as nothing, or
            as "multiplication x". */}
        <TooltipTrigger>
          <Button
            icon={<X />}
            size="sm"
            variant="ghost"
            aria-label={t('common.cancel')}
            onPress={onCancel}
            isDisabled={saving}
          />
          <Tooltip>{t('common.cancel')}</Tooltip>
        </TooltipTrigger>
      </div>
    </div>
  )
}

/**
 * Choosing the directory a hosted session will work in.
 */
function NewHostedSessionForm({
  draft,
  launch,
  onSubmit,
  onCancel,
}: {
  draft: ReturnType<typeof useDraft>
  launch: ReturnType<typeof useHostedLaunch>
  onSubmit: (cwd: string) => Promise<string | null>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { path, setPath } = draft
  const { starting, error, setStarting, setError } = launch

  const handleBrowse = useCallback(async () => {
    // Cancelling the picker rejects on Android instead of resolving to null.
    const selected = await open({ directory: true, multiple: false }).catch(() => null)
    if (selected) setPath(selected)
  }, [setPath])

  const submit = async () => {
    const cwd = path.trim()
    if (!cwd || starting) return
    setStarting(true)
    setError(null)
    const failure = await onSubmit(cwd)
    setStarting(false)
    if (failure) setError(failure)
  }

  return (
    <div data-slot="hosted-session-form" className="m-sidebar__form">
      {can.browseForDirectory ? (
        <Button
          icon={<FolderOpen />}
          type="button"
          size="sm"
          variant="secondary"
          onPress={() => void handleBrowse()}
          className="m-sidebar__form-browse"
        >
          <span
            data-slot="hosted-session-form-path"
            onPointerEnter={titleIfTruncated}
            className="m-sidebar__form-path"
            data-empty={!path || undefined}
          >
            {path || t('sidebar.hostedSessionFolder')}
          </span>
        </Button>
      ) : (
        <TextField
          aria-label={t('sidebar.hostPath')}
          value={path}
          onChange={(e) => setPath(e)}
          placeholder={t('sidebar.hostPathPlaceholder')}
          autoFocus
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') void submit()
            else if (e.key === 'Escape') onCancel()
          }}
        />
      )}
      {error && (
        <p data-slot="hosted-session-form-error" role="alert" className="m-sidebar__form-error">
          {error}
        </p>
      )}
      <div data-slot="hosted-session-form-actions" className="m-sidebar__form-actions">
        <Button
          variant="secondary"
          size="sm"
          aria-busy={starting}
          onPress={() => void submit()}
          isDisabled={!path.trim()}
          isPending={starting}
          className="m-sidebar__form-submit"
        >
          {t('sidebar.startHostedSession')}
        </Button>
        <TooltipTrigger>
          <Button
            icon={<X />}
            size="sm"
            variant="ghost"
            aria-label={t('common.cancel')}
            onPress={onCancel}
            isDisabled={starting}
          />
          <Tooltip>{t('common.cancel')}</Tooltip>
        </TooltipTrigger>
      </div>
    </div>
  )
}

/** Which row was right-clicked, and where to anchor the context menu popover. */
interface ContextMenuState {
  kind: 'conversation' | 'project'
  id: string
  x: number
  y: number
}

interface MenuHit {
  kind: 'conversation' | 'project'
  id: string
}

/**
 * The hook gates' transcripts — `hooks/protocol.rs` names the two kinds. A
 * review is opened by another agent's hook, not by a person, and a project
 * under active development grows one per plan and one per stop; left in the
 * list they outnumber the conversations somebody actually started.
 */
const REVIEW_KINDS = new Set<string>(['plan_review', 'impl_review'])

function isReview(conversation: ConversationInfoResponse): boolean {
  return typeof conversation.agent_kind === 'string' && REVIEW_KINDS.has(conversation.agent_kind)
}

/**
 * The conversations of each project, and the ones belonging to none — with
 * each group's reviews set aside for the fold under it.
 */
function groupByProject(conversations: ConversationInfoResponse[]) {
  const filed = new Map<string, ConversationInfoResponse[]>()
  const loose: ConversationInfoResponse[] = []
  const reviews = new Map<string | null, ConversationInfoResponse[]>()
  for (const conversation of conversations) {
    if (isReview(conversation)) {
      const key = conversation.project_id ?? null
      const existing = reviews.get(key)
      if (existing) existing.push(conversation)
      else reviews.set(key, [conversation])
      continue
    }
    if (!conversation.project_id) {
      loose.push(conversation)
      continue
    }
    const existing = filed.get(conversation.project_id)
    if (existing) existing.push(conversation)
    else filed.set(conversation.project_id, [conversation])
  }
  return { filed, loose, reviews }
}

/** The loose group's key in the folded set. Project ids are uuids, so this
 *  cannot collide with one. */
const LOOSE_KEY = 'loose'

function ConversationNavItem({
  conv,
  activeId,
  transcriptInert,
  dndDisabled,
  actions,
  onSelect,
}: {
  conv: ConversationInfoResponse
  activeId: string | null
  transcriptInert: boolean
  dndDisabled: boolean
  actions: RowAction[]
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const title = conv.title ?? t('sidebar.newChat')
  const { dragProps, isDragging } = useDrag({
    isDisabled: dndDisabled,
    getItems: () => [{ [CONVERSATION_DRAG_TYPE]: conv.id }],
    getAllowedDropOperations: () => ['move', 'copy'],
  })

  return (
    <NavItem
      id={`conv-${conv.id}`}
      data-row-id={conv.id}
      data-row-kind="conversation"
      isCurrent={conv.id === activeId}
      icon={conv.is_archived ? <Archive /> : <ConversationIcon agentKind={conv.agent_kind} />}
      className={conv.is_archived ? 'm-sidebar__archived' : undefined}
      onPress={() => onSelect(conv.id)}
      trailing={
        <span className="m-sidebar__conv-meta">
          {conv.is_pinned && <Bookmark aria-label={t('contextMenu.pin')} className="m-sidebar__pin" />}
          <ConversationIndicator conversationId={conv.id} activeId={activeId} transcriptInert={transcriptInert} />
          <ConversationTime updatedAt={conv.updated_at} />
        </span>
      }
      actions={<RowActionsMenu label={title} actions={actions} />}
    >
      <span
        {...dragProps}
        className="m-sidebar__conv-title"
        data-dragging={isDragging || undefined}
        onPointerEnter={titleIfTruncated}
      >
        {title}
      </span>
    </NavItem>
  )
}

interface ConversationGroupProps {
  /** `null` is the loose group — the drop that unfiles. */
  projectId: string | null
  title: string
  isCurrent: boolean
  folded: boolean
  conversations: ConversationInfoResponse[]
  onToggleFold: () => void
  /** Absent on the loose group, which is not selectable. */
  onSelectToggle?: () => void
  onNewConversation: () => void
  /** The "…" dropdown's rows; absent on the loose group. */
  actions?: RowAction[]
  activeId: string | null
  transcriptInert: boolean
  dndDisabled: boolean
  moveDropped: (items: DropItem[], projectId: string | null) => Promise<void>
  conversationActions: (conv: ConversationInfoResponse) => RowAction[]
  onSelectConversation: (id: string) => void
  /** This group's hook-gate transcripts, folded under its own rows. */
  reviewConversations: ConversationInfoResponse[]
  reviewsExpanded: boolean
  onToggleReviewsExpanded: () => void
  archivedConversations: ConversationInfoResponse[]
  archivedExpanded: boolean
  onToggleArchivedExpanded: () => void
}

function ConversationGroup({
  projectId,
  title,
  isCurrent,
  folded,
  conversations,
  onToggleFold,
  onSelectToggle,
  onNewConversation,
  actions,
  activeId,
  transcriptInert,
  dndDisabled,
  moveDropped,
  conversationActions,
  onSelectConversation,
  reviewConversations,
  reviewsExpanded,
  onToggleReviewsExpanded,
  archivedConversations,
  archivedExpanded,
  onToggleArchivedExpanded,
}: ConversationGroupProps) {
  const { t } = useTranslation()
  const foldLabel = folded ? t('sidebar.unfoldGroup', { name: title }) : t('sidebar.foldGroup', { name: title })

  const renderConversation = (conv: ConversationInfoResponse) => (
    <ConversationNavItem
      key={conv.id}
      conv={conv}
      activeId={activeId}
      transcriptInert={transcriptInert}
      dndDisabled={dndDisabled}
      actions={conversationActions(conv)}
      onSelect={onSelectConversation}
    />
  )

  const hasItems = conversations.length > 0 || reviewConversations.length > 0 || archivedConversations.length > 0

  return (
    <DropZone
      aria-label={projectId ? t('sidebar.moveInto', { name: title }) : t('sidebar.moveOut')}
      getDropOperation={(types) => (acceptsConversationDrop(types) ? 'move' : 'cancel')}
      onDrop={(e) => void moveDropped(e.items, projectId)}
      className="m-sidebar__drop-zone"
    >
      <NavList size="sm" showGuides aria-label={title}>
        <NavGroup
          data-row-id={projectId ?? undefined}
          data-row-kind={projectId ? 'project' : undefined}
          label={
            projectId ? (
              <span className="m-sidebar__project-label">
                <span
                  data-slot="sidebar-group-title"
                  onPointerEnter={titleIfTruncated}
                  className="m-sidebar__project-name"
                >
                  {title}
                </span>
                {isCurrent && <span className="m-sidebar__project-dot" aria-hidden />}
              </span>
            ) : (
              <span
                data-slot="sidebar-group-title"
                onPointerEnter={titleIfTruncated}
                className="m-sidebar__project-name"
              >
                {title}
              </span>
            )
          }
          toggleLabel={foldLabel}
          isExpanded={!folded}
          onExpandedChange={() => onToggleFold()}
          onPress={onSelectToggle}
          isSelected={onSelectToggle ? isCurrent : undefined}
          actions={
            <span data-slot="sidebar-group-actions" className="m-sidebar__row-actions">
              <TooltipTrigger>
                <Button
                  icon={<Plus />}
                  size="sm"
                  variant="ghost"
                  aria-label={projectId ? t('sidebar.newConversationIn', { name: title }) : t('sidebar.newChat')}
                  onPress={onNewConversation}
                  className="m-sidebar__icon-btn"
                />
                <Tooltip>{projectId ? t('sidebar.newConversationIn', { name: title }) : t('sidebar.newChat')}</Tooltip>
              </TooltipTrigger>
              {actions && actions.length > 0 && <RowActionsMenu label={title} actions={actions} />}
            </span>
          }
        >
          {hasItems ? (
            <>
              {conversations.map(renderConversation)}
              {reviewConversations.length > 0 && (
                <NavGroup
                  icon={<GitPullRequest />}
                  label={t('sidebar.reviewsCount', { count: reviewConversations.length })}
                  isExpanded={reviewsExpanded}
                  onExpandedChange={onToggleReviewsExpanded}
                >
                  {reviewConversations.map(renderConversation)}
                </NavGroup>
              )}
              {archivedConversations.length > 0 && (
                <NavGroup
                  icon={<Archive />}
                  label={t('sidebar.archivedCount', { count: archivedConversations.length })}
                  isExpanded={archivedExpanded}
                  onExpandedChange={onToggleArchivedExpanded}
                >
                  {archivedConversations.map(renderConversation)}
                </NavGroup>
              )}
            </>
          ) : null}
        </NavGroup>
      </NavList>
    </DropZone>
  )
}

export function AppSidebar({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onOpenSearch,
  onDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
  onMoveToProject,
  page,
  onOpenSettings,
  onOpenBoard,
  onCloseSettings,
  settingsTab,
  onSettingsTabChange,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
  onCreateHostedSession,
  isCollapsed = false,
  onDrawerOpenChange,
}: AppSidebarProps) {
  const { t } = useTranslation()
  const platform = usePlatform()
  const navCollapsed = useContext(NavCollapsedContext)
  const isIconCollapsed = isCollapsed || navCollapsed

  /**
   * Whether the machine that would run the adapter can run one.
   * Remote mode runs on the desktop host, so Android in remote mode can too.
   */
  const canHostSessions = platform !== 'android' || isRemote
  const [showNewProject, setShowNewProject] = useState(false)
  const [showNewHosted, setShowNewHosted] = useState(false)
  const projectDraft = useDraft()
  const projectCreation = useProjectCreation()
  const hostedDraft = useDraft()
  const hostedLaunch = useHostedLaunch()
  const [picker, setPicker] = useState<{ mode: 'import' | 'attach'; conversationId?: string } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ type: 'conversation' | 'project'; id: string } | null>(null)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [movePending, setMovePending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isBusy = (id: string) => {
    const session = useConversationStore.getState().sessions[id]
    return !!session && (session.streaming || session.activeShellTurnId !== null)
  }
  const reportFailure = useCallback(
    (messageKey: string, task: Promise<void>) => {
      setActionError(null)
      task.catch((error: unknown) => setActionError(t(messageKey, { error: String(error) })))
    },
    [t],
  )
  const [archivedConversations, setArchivedConversations] = useState<ConversationInfoResponse[]>([])
  const archivedLoaded = useRef(false)
  const [expandedArchivedGroups, setExpandedArchivedGroups] = useState<Set<string | null>>(new Set())
  const { confirm, confirmDialog } = useConfirm()
  const hiddenConversations = useUndoStore((s) => s.hidden)

  const loadArchived = useCallback(async () => {
    const archived = await api.listConversations(true)
    setArchivedConversations(archived)
    archivedLoaded.current = true
  }, [])

  useEffect(() => {
    void loadArchived()
  }, [conversations, loadArchived])

  const archivedByProject = useMemo(() => {
    const map = new Map<string | null, ConversationInfoResponse[]>()
    for (const conv of archivedConversations) {
      if (hiddenConversations.has(conv.id)) continue
      const key = conv.project_id ?? null
      const list = map.get(key)
      if (list) list.push(conv)
      else map.set(key, [conv])
    }
    return map
  }, [archivedConversations, hiddenConversations])

  const toggleArchivedGroup = useCallback(
    (groupKey: string | null) => {
      setExpandedArchivedGroups((prev) => {
        const next = new Set(prev)
        if (next.has(groupKey)) next.delete(groupKey)
        else next.add(groupKey)
        return next
      })
      if (!archivedLoaded.current) void loadArchived()
    },
    [loadArchived],
  )

  const [expandedReviewGroups, setExpandedReviewGroups] = useState<ReadonlySet<string | null>>(
    () => new Set<string | null>(),
  )
  const toggleReviewGroup = useCallback((groupKey: string | null) => {
    setExpandedReviewGroups((prev) => {
      const next = new Set(prev)
      if (!next.delete(groupKey)) next.add(groupKey)
      return next
    })
  }, [])

  /**
   * Wraps a row's action so that the mobile drawer gets out of the way.
   */
  const dismissing = useCallback(
    <A extends unknown[]>(run: (...args: A) => void) =>
      (...args: A) => {
        onDrawerOpenChange?.(false)
        run(...args)
      },
    [onDrawerOpenChange],
  )

  const selectConversation = dismissing(onSelect)
  const selectProject = dismissing(onSelectProject)
  const createConversation = dismissing(onCreate)
  const openSearch = dismissing(onOpenSearch)
  const openSettings = dismissing(onOpenSettings)
  const openBoard = dismissing(onOpenBoard)
  const closeSettings = dismissing(onCloseSettings)
  const changeSettingsTab = dismissing(onSettingsTabChange)

  // Right-click / long-press context menu anchored at the pointer coordinates.
  const hitRef = useRef<MenuHit | null>(null)
  const contextAnchorRef = useRef<HTMLSpanElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const { filed, loose, reviews } = useMemo(() => groupByProject(conversations), [conversations])

  // Which groups are folded shut, keyed by project id (`LOOSE_KEY` for the
  // loose group). Groups start open and folding is opt-out.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set<string>())
  const toggleFold = useCallback((key: string) => {
    setFolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  // Whatever is on screen has its group opened for it.
  const activeConversation = conversations.find((c) => c.id === activeId)
  const activeGroupKey = activeConversation ? (activeConversation.project_id ?? LOOSE_KEY) : null
  useEffect(() => {
    if (!activeGroupKey) return
    setFolded((prev) => {
      if (!prev.has(activeGroupKey)) return prev
      const next = new Set(prev)
      next.delete(activeGroupKey)
      return next
    })
  }, [activeGroupKey])

  const activeReviewGroup =
    activeConversation && isReview(activeConversation) ? activeConversation.project_id : undefined
  useEffect(() => {
    if (activeReviewGroup === undefined) return
    setExpandedReviewGroups((prev) => {
      if (prev.has(activeReviewGroup)) return prev
      const next = new Set(prev)
      next.add(activeReviewGroup)
      return next
    })
  }, [activeReviewGroup])

  const dndDisabled = isCoarsePointer()

  const moveDropped = useCallback(
    async (items: DropItem[], projectId: string | null) => {
      for (const item of items) {
        if (item.kind !== 'text' || !item.types.has(CONVERSATION_DRAG_TYPE)) continue
        const id = await item.getText(CONVERSATION_DRAG_TYPE)
        if (!id) continue
        const current = conversations.find((c) => c.id === id)?.project_id ?? null
        if (current === projectId) continue
        const failure = await onMoveToProject(id, projectId)
        if (failure) {
          setMoveTarget(id)
          setMoveError(failure)
          return
        }
      }
    },
    [conversations, onMoveToProject],
  )

  const conversationActions = useConversationActions({
    onTogglePin: (id) => reportFailure('sidebar.pinFailed', onTogglePin(id)),
    onToggleArchive: (id) => reportFailure('sidebar.archiveFailed', onToggleArchive(id)),
    onRequestRename: (id) => setRenameTarget({ type: 'conversation', id }),
    onRequestMove: (id) => {
      setMoveError(null)
      setMoveTarget(id)
    },
    onExportError: (error) => setActionError(t('sidebar.exportFailed', { error: String(error) })),
    onRequestDelete: async (id) => {
      if (isBusy(id)) {
        if (
          await confirm({
            description: t('confirm.deleteConversation'),
            confirmLabel: t('common.delete'),
            tone: 'danger',
          })
        )
          reportFailure('sidebar.deleteFailed', onDelete(id))
        return
      }
      const conversation = conversations.find((c) => c.id === id) ?? archivedConversations.find((c) => c.id === id)
      const store = useConversationStore.getState()
      const wasOpen = store.activeId === id
      if (wasOpen) store.setActiveId(null)
      useUndoStore.getState().offer({
        conversationId: id,
        title: conversation?.title ?? null,
        commit: async () => {
          if (isBusy(id)) {
            setActionError(t('sidebar.deleteCancelledBusy'))
            return
          }
          const task = onDelete(id)
          reportFailure('sidebar.deleteFailed', task)
          await task
          setArchivedConversations((current) => current.filter((c) => c.id !== id))
        },
        restore: () => {
          if (wasOpen) useConversationStore.getState().setActiveId(id)
        },
      })
    },
    onRequestAttachSession: canHostSessions
      ? (id: string) => dismissing(() => setPicker({ mode: 'attach', conversationId: id }))()
      : undefined,
  })

  const projectActions = useProjectActions({
    onRequestRename: (id) => setRenameTarget({ type: 'project', id }),
    onRequestDelete: async (id) => {
      if (await confirm({ description: t('confirm.deleteProject'), confirmLabel: t('common.delete'), tone: 'danger' }))
        reportFailure('sidebar.deleteProjectFailed', onDeleteProject(id))
    },
  })

  const hitConversation =
    contextMenu?.kind === 'conversation'
      ? (conversations.find((c) => c.id === contextMenu.id) ??
        archivedConversations.find((c) => c.id === contextMenu.id))
      : undefined
  const hitProject = contextMenu?.kind === 'project' ? projects.find((p) => p.id === contextMenu.id) : undefined
  const hitActions = hitConversation
    ? conversationActions(hitConversation)
    : hitProject
      ? projectActions(hitProject)
      : []

  const recordHit = useCallback((target: EventTarget | null) => {
    const row = (target as HTMLElement | null)?.closest('[data-row-id]')
    const id = row?.getAttribute('data-row-id')
    const kind = row?.getAttribute('data-row-kind') as MenuHit['kind'] | null | undefined
    hitRef.current = id && kind ? { kind, id } : null
  }, [])

  const hitLabel = t('sidebar.moreActions', { name: hitConversation?.title ?? hitProject?.name ?? '' })

  const renaming =
    renameTarget?.type === 'project'
      ? projects.find((p) => p.id === renameTarget.id)?.name
      : ((
          conversations.find((c) => c.id === renameTarget?.id) ??
          archivedConversations.find((c) => c.id === renameTarget?.id)
        )?.title ?? '')

  const searchShortcut =
    platform === null ? ['Ctrl/⌘', 'K'] : platform === 'macos' || platform === 'ios' ? ['⌘', 'K'] : ['Ctrl', 'K']

  const settingsSide = (
    <div className="m-sidebar">
      <div className="m-sidebar__header">
        <NavList size="sm" aria-label={t('settings.backToApp')}>
          <NavItem icon={<ArrowLeft />} onPress={closeSettings}>
            {t('settings.backToApp')}
          </NavItem>
        </NavList>
      </div>
      <div className="m-sidebar__body">
        <NavList size="sm" aria-label={t('sidebar.settings')}>
          {visibleSettingsTabGroups(platform).map(({ group, tabs }) => (
            <NavSection key={group.id} header={t(group.labelKey)}>
              {tabs.map((tab) => (
                <NavItem
                  key={tab.id}
                  icon={<tab.icon />}
                  isCurrent={settingsTab === tab.id}
                  onPress={() => changeSettingsTab(tab.id)}
                >
                  {t(tab.labelKey)}
                </NavItem>
              ))}
            </NavSection>
          ))}
        </NavList>
      </div>
    </div>
  )

  const chatSide = (
    <div className="m-sidebar">
      <div className="m-sidebar__header">
        <NavList size="sm" aria-label={t('sidebar.newChat')}>
          <NavItem
            icon={<Plus />}
            onPress={() => createConversation()}
            actions={
              canHostSessions ? (
                <MenuTrigger>
                  <TooltipTrigger>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<MoreVertical />}
                      aria-label={t('sidebar.newChatMore')}
                      className="m-sidebar__icon-btn"
                    />
                    <Tooltip>{t('sidebar.newChatMore')}</Tooltip>
                  </TooltipTrigger>
                  <Menu placement="bottom end" aria-label={t('sidebar.newChatMore')}>
                    <MenuItem id="new-hosted" icon={<Terminal />} onAction={() => setShowNewHosted((open) => !open)}>
                      {t('sidebar.newHostedSession')}
                    </MenuItem>
                    <MenuItem
                      id="import-hosted"
                      icon={<ArrowInDownDashedPanel />}
                      onAction={dismissing(() => setPicker({ mode: 'import' }))}
                    >
                      {t('sidebar.importHostedSession')}
                    </MenuItem>
                  </Menu>
                </MenuTrigger>
              ) : undefined
            }
          >
            {t('sidebar.newChat')}
          </NavItem>
          <NavItem icon={<Search />} onPress={openSearch} trailing={<Kbd keys={searchShortcut} />}>
            {t('sidebar.search')}
          </NavItem>
          {canHostSessions && (
            <NavItem icon={<LayoutDashboard />} isCurrent={page === 'board'} onPress={openBoard}>
              {t('board.title')}
            </NavItem>
          )}
        </NavList>
        {showNewHosted && (
          <NewHostedSessionForm
            draft={hostedDraft}
            launch={hostedLaunch}
            onSubmit={async (cwd) => {
              const failure = await onCreateHostedSession(cwd)
              if (!failure) {
                setShowNewHosted(false)
                hostedDraft.reset()
                hostedLaunch.reset()
              }
              return failure
            }}
            onCancel={() => {
              setShowNewHosted(false)
              hostedDraft.reset()
              hostedLaunch.reset()
            }}
          />
        )}
      </div>

      <div className="m-sidebar__body">
        {!isIconCollapsed && (
          <>
            <div
              className="m-sidebar__groups"
              onPointerDown={(e) => recordHit(e.target)}
              onContextMenuCapture={(e) => recordHit(e.target)}
              onContextMenu={(e) => {
                recordHit(e.target)
                const hit = hitRef.current
                if (!hit) return
                e.preventDefault()
                setContextMenu({ ...hit, x: e.clientX, y: e.clientY })
              }}
            >
              {projects.map((project) => (
                <ConversationGroup
                  key={project.id}
                  projectId={project.id}
                  title={project.name}
                  isCurrent={project.id === activeProjectId}
                  folded={folded.has(project.id)}
                  conversations={filed.get(project.id) ?? []}
                  onToggleFold={() => toggleFold(project.id)}
                  onSelectToggle={() => selectProject(project.id === activeProjectId ? null : project.id)}
                  onNewConversation={() => createConversation(project.id)}
                  actions={projectActions(project)}
                  activeId={activeId}
                  transcriptInert={page !== 'chat'}
                  dndDisabled={dndDisabled}
                  moveDropped={moveDropped}
                  conversationActions={conversationActions}
                  onSelectConversation={selectConversation}
                  reviewConversations={reviews.get(project.id) ?? []}
                  reviewsExpanded={expandedReviewGroups.has(project.id)}
                  onToggleReviewsExpanded={() => toggleReviewGroup(project.id)}
                  archivedConversations={archivedByProject.get(project.id) ?? []}
                  archivedExpanded={expandedArchivedGroups.has(project.id)}
                  onToggleArchivedExpanded={() => toggleArchivedGroup(project.id)}
                />
              ))}
              {/* Conversations belonging to no project. Always rendered so dragging
                  out of a project always has a target. */}
              <ConversationGroup
                projectId={null}
                title={t('sidebar.conversations')}
                isCurrent={false}
                folded={folded.has(LOOSE_KEY)}
                conversations={loose}
                onToggleFold={() => toggleFold(LOOSE_KEY)}
                onNewConversation={() => createConversation(null)}
                activeId={activeId}
                transcriptInert={page !== 'chat'}
                dndDisabled={dndDisabled}
                moveDropped={moveDropped}
                conversationActions={conversationActions}
                onSelectConversation={selectConversation}
                reviewConversations={reviews.get(null) ?? []}
                reviewsExpanded={expandedReviewGroups.has(null)}
                onToggleReviewsExpanded={() => toggleReviewGroup(null)}
                archivedConversations={archivedByProject.get(null) ?? []}
                archivedExpanded={expandedArchivedGroups.has(null)}
                onToggleArchivedExpanded={() => toggleArchivedGroup(null)}
              />
            </div>

            {/* Opening the inline new-project form stays inside the drawer on
                narrow screens, so opt out of NavList's auto-dismiss context. */}
            <NavigateContext.Provider value={undefined}>
              <NavList size="sm" aria-label={t('sidebar.newProject')}>
                <NavItem icon={<FolderPlus />} onPress={() => setShowNewProject(true)}>
                  {t('sidebar.newProject')}
                </NavItem>
              </NavList>
            </NavigateContext.Provider>
            {showNewProject && (
              <NewProjectForm
                draft={projectDraft}
                creation={projectCreation}
                onSubmit={async (name, path) => {
                  await onCreateProject(name, path)
                  setShowNewProject(false)
                  projectDraft.reset()
                  projectCreation.reset()
                }}
                onCancel={() => {
                  setShowNewProject(false)
                  projectDraft.reset()
                  projectCreation.reset()
                }}
              />
            )}
          </>
        )}
      </div>

      <div className="m-sidebar__footer">
        {actionError && (
          <Alert tone="danger" shouldAnnounce data-slot="sidebar-action-error" onDismiss={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}
        <NavList size="sm" aria-label={t('sidebar.settings')}>
          <NavItem icon={<Settings />} onPress={openSettings}>
            {t('sidebar.settings')}
          </NavItem>
        </NavList>
      </div>
    </div>
  )

  return (
    <>
      {page === 'settings' ? settingsSide : chatSide}

      <span
        ref={contextAnchorRef}
        aria-hidden
        className="m-sidebar__context-anchor"
        style={contextMenu ? { left: contextMenu.x, top: contextMenu.y } : undefined}
      />
      <Popover
        triggerRef={contextAnchorRef}
        isOpen={contextMenu !== null && hitActions.length > 0}
        onOpenChange={(open) => {
          if (!open) setContextMenu(null)
        }}
        placement="bottom start"
        offset={0}
      >
        <Menu variant="inline" aria-label={hitLabel} onAction={() => setContextMenu(null)}>
          {hitConversation ? (
            <ConversationTimeSection updatedAt={hitConversation.updated_at}>
              <RowActionDropdownItems actions={hitActions} grouped />
            </ConversationTimeSection>
          ) : (
            <RowActionDropdownItems actions={hitActions} grouped />
          )}
        </Menu>
      </Popover>

      <RenameDialog
        isOpen={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        initialValue={renaming ?? ''}
        heading={t('contextMenu.rename')}
        onSubmit={(value) => {
          if (!renameTarget) return
          if (renameTarget.type === 'project') {
            reportFailure('sidebar.renameProjectFailed', onRenameProject(renameTarget.id, value))
          } else {
            reportFailure('sidebar.renameFailed', onRename(renameTarget.id, value))
          }
        }}
      />

      <MoveDialog
        isOpen={moveTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMoveTarget(null)
            setMoveError(null)
          }
        }}
        projects={projects}
        currentProjectId={conversations.find((c) => c.id === moveTarget)?.project_id ?? null}
        error={moveError}
        isPending={movePending}
        onMove={async (projectId) => {
          if (!moveTarget || movePending) return false
          setMovePending(true)
          setMoveError(null)
          const failure = await onMoveToProject(moveTarget, projectId)
          setMovePending(false)
          if (failure) {
            setMoveError(failure)
            return false
          }
          return true
        }}
      />

      {picker && (
        <ClaudeSessionPicker
          isOpen
          onOpenChange={(open) => {
            if (!open) setPicker(null)
          }}
          mode={picker.mode}
          conversationId={picker.conversationId}
          onOpenConversation={selectConversation}
        />
      )}

      {confirmDialog}
    </>
  )
}
