/**
 * The sidebar, on HeroUI Pro's — a panel on a wide window, a sheet on a narrow
 * one, and the phone's conversation list either way.
 *
 * The shape is HeroUI Pro's agent-workspace example: one `Sidebar.Group` per
 * project with the group label carrying the project's own affordances (fold,
 * select, new-conversation, actions, and the drop target a drag files into),
 * and a flat menu of conversation rows under it. There is no project row and
 * no nested tree any more — a conversation row looks the same wherever it
 * lives, and where it lives is said by the group above it.
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
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DropZone, useDragAndDrop } from 'react-aria-components'
import type { DropItem, Key } from 'react-aria-components'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Alert,
  Button,
  Dropdown,
  DropdownItem,
  DropdownPopover,
  Input,
  Label,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import { ContextMenu } from '@/components/base'
import { Sidebar, useSidebar } from '@/components/base'
import {
  Archive,
  ArrowDownToSquare,
  ArrowLeft,
  ChevronRight,
  CodePullRequestCheck,
  EllipsisVertical,
  FolderOpen,
  FolderPlus,
  Gear,
  Grip,
  Magnifier,
  Pin,
  Plus,
  Terminal,
  Xmark,
} from '@gravity-ui/icons'
import { ConversationIcon } from '@/components/ui/agent-icon'
import { ClaudeSessionPicker } from './claude-session-picker'

import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { cn } from '@/lib/utils'
import { isRemote } from '@/lib/transport'
import type { ConversationInfoResponse, ProjectInfoResponse } from '@/types'
import type { Page } from './shell-props'
// Not from the settings barrel: this is a value import, and the barrel would
// pull the whole lazily-loaded settings chunk into the main bundle.
import { visibleSettingsTabs, type SettingsTab } from '@/components/settings/tabs'
import { usePlatform } from '@/hooks/use-platform'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { useConfirm } from '@/hooks/use-confirm'
import { isCoarsePointer } from '@/hooks/use-coarse-pointer'
import { ConversationIndicator } from './conversation-indicator'
import { MoveDialog } from './move-dialog'
import { acceptsConversationDrop, CONVERSATION_DRAG_TYPE, conversationIdOf } from './sidebar-dnd'
import { RenameDialog } from './rename-dialog'
import { RowActionDropdownItems, RowActionsMenu } from './row-actions-menu'
import { useConversationActions, useProjectActions, type RowAction } from './row-actions'

interface AppSidebarProps {
  conversations: ConversationInfoResponse[]
  activeId: string | null
  onSelect: (id: string) => void
  /** Start a conversation — under `projectId` when given, under the active
   *  project when omitted, loose when `null`. */
  onCreate: (projectId?: string | null) => void | Promise<void>
  /** Open the command palette — the sidebar's search row is its second door. */
  onOpenSearch: () => void
  onDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => void
  onTogglePin: (id: string) => void
  onToggleArchive: (id: string) => void
  /** Refile a conversation under another project, or under none (`null`). */
  onMoveToProject: (id: string, projectId: string | null) => Promise<string | null>
  page: Page
  onOpenSettings: () => void
  onCloseSettings: () => void
  settingsTab: SettingsTab
  onSettingsTabChange: (tab: SettingsTab) => void
  projects: ProjectInfoResponse[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => void | Promise<void>
  onDeleteProject: (id: string) => void
  onRenameProject: (id: string, newName: string) => void
  /** Start a hosted Claude Code session in `cwd`. Resolves to the reason it
   *  failed, or `null`. Desktop only. */
  onCreateHostedSession: (cwd: string) => Promise<string | null>
}

/**
 * The draft, held above the two sidebars rather than inside them.
 *
 * Below 768px Pro renders this tree twice — the panel, hidden with
 * `display: none`, and the sheet — so a `useState` in the form is two pieces of
 * state, and crossing the breakpoint swaps which one is on screen. Typing a
 * project name in a narrow window and then widening it produced an empty form.
 * One hook, lifted to the component that exists once.
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

/**
 * The hosted form's *request*, lifted for the same reason its fields are — and
 * for a worse consequence.
 *
 * Starting a session takes seconds, long enough to download the adapter on a
 * machine that has never run it, so the form stays up and disables its button
 * while it waits. Held in the form, that flag is two flags: cross 768px during
 * the wait and the instance that appears has never started anything, so the
 * button is live and the same directory can be submitted again. Two adapters,
 * two sessions, one folder — and the first one's failure would land on an
 * instance nobody can see, which is why `error` comes up here too.
 */
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
    <div data-slot="project-form" className="px-2 py-1.5 space-y-1.5">
      <Input
        type="text"
        aria-label={t('sidebar.projectName')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('sidebar.projectName')}
        className="text-xs"
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
          type="button"
          variant="outline"
          onPress={() => void handleBrowse()}
          isDisabled={saving}
          className="w-full justify-start text-xs"
        >
          <FolderOpen className="text-muted" />
          <span data-slot="project-form-path" className={path ? 'text-foreground truncate' : 'text-muted'}>
            {path || t('sidebar.browsePath')}
          </span>
        </Button>
      ) : (
        <Input
          type="text"
          aria-label={t('sidebar.hostPath')}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t('sidebar.hostPathPlaceholder')}
          className="text-xs"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') void submit()
            else if (e.key === 'Escape') onCancel()
          }}
        />
      )}
      {error && (
        <p data-slot="project-form-error" role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div data-slot="project-form-actions" className="flex gap-1">
        <Button
          variant="secondary"
          aria-busy={saving}
          onPress={() => void submit()}
          isDisabled={!name.trim() || !path.trim()}
          isPending={saving}
          className="flex-1"
        >
          {t('common.save')}
        </Button>
        {/* The glyph is not a name: a screen reader reads U+2715 as nothing, or
            as "multiplication x". */}
        <TooltipTrigger delay={0}>
          <Button iconOnly variant="ghost" aria-label={t('common.cancel')} onPress={onCancel} isDisabled={saving}>
            <Xmark />
          </Button>
          <Tooltip>{t('common.cancel')}</Tooltip>
        </TooltipTrigger>
      </div>
    </div>
  )
}

/**
 * Choosing the directory a hosted session will work in.
 *
 * A folder and nothing else: the session names itself after the folder, and the
 * agent inside it has no configuration here to set — which model it uses and
 * what it is allowed to do are its own business, decided by whatever `claude` is
 * logged in as.
 */
function NewHostedSessionForm({
  draft,
  launch,
  onSubmit,
  onCancel,
}: {
  /** Lifted for the same reason as the project form's — see {@link useDraft}. */
  draft: ReturnType<typeof useDraft>
  /** And so is the request it makes — see {@link useHostedLaunch}. */
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

  // Starting an adapter takes seconds — on a machine that has never run it, long
  // enough to download the package first. The form stays up and says so, because
  // closing it on submit would leave that whole wait with nothing on screen and
  // a failure with nowhere to land.
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
    <div data-slot="hosted-session-form" className="px-2 py-1.5 space-y-1.5">
      {/* Same split as a project's path, for the same reason: the adapter runs
          on the machine the backend is on, so a picker showing this device's
          folders would be pointing at the wrong filesystem. */}
      {can.browseForDirectory ? (
        <Button
          type="button"
          variant="outline"
          onPress={() => void handleBrowse()}
          className="w-full justify-start text-xs"
        >
          <FolderOpen className="text-muted" />
          <span data-slot="hosted-session-form-path" className={path ? 'text-foreground truncate' : 'text-muted'}>
            {path || t('sidebar.hostedSessionFolder')}
          </span>
        </Button>
      ) : (
        <Input
          type="text"
          aria-label={t('sidebar.hostPath')}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t('sidebar.hostPathPlaceholder')}
          className="text-xs"
          autoFocus
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') void submit()
            else if (e.key === 'Escape') onCancel()
          }}
        />
      )}
      {error && (
        <p data-slot="hosted-session-form-error" role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div data-slot="hosted-session-form-actions" className="flex gap-1">
        <Button
          variant="secondary"
          aria-busy={starting}
          onPress={() => void submit()}
          isDisabled={!path.trim()}
          isPending={starting}
          className="flex-1"
        >
          {t('sidebar.startHostedSession')}
        </Button>
        <TooltipTrigger delay={0}>
          <Button iconOnly variant="ghost" aria-label={t('common.cancel')} onPress={onCancel} isDisabled={starting}>
            <Xmark />
          </Button>
          <Tooltip>{t('common.cancel')}</Tooltip>
        </TooltipTrigger>
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
 *
 * Grouping happens here rather than in SQL because the order inside each group
 * has to be the order the list arrived in — pinned first, then by recency — and
 * a second query per project would sort each one independently of the whole.
 * The reviews are keyed the way the archived map is: the project id, or `null`
 * for the loose group.
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

function RowActionItems({ actions }: { actions: RowAction[] }) {
  return (
    <>
      {actions.map((action, i) => (
        <Fragment key={action.key}>
          {i > 0 && GROUP_STARTS.has(action.key) && <ContextMenu.Separator />}
          <ContextMenu.Item
            id={action.key}
            textValue={action.label}
            variant={action.variant === 'destructive' ? 'danger' : undefined}
            isDisabled={Boolean(action.disabledReason)}
            onAction={() => void action.run()}
          >
            <action.icon className="size-4" />
            <Label>{action.label}</Label>
            {/* Beside the label rather than in a tooltip — see `RowAction`. */}
            {action.disabledReason && (
              <span data-slot="row-action-disabled-reason" className="ml-auto shrink-0 text-xs text-muted">
                {action.disabledReason}
              </span>
            )}
          </ContextMenu.Item>
        </Fragment>
      ))}
    </>
  )
}

/** The loose group's key in the folded set. Project ids are uuids, so this
 *  cannot collide with one. */
const LOOSE_KEY = 'loose'

/**
 * The panel keeps the example's density; the mobile sheet keeps Pro's default,
 * because a finger needs the taller row. Withheld while settings fills the
 * pane — that side is a short nav list, and two densities inside one app read
 * as a bug.
 */
const DENSITY = { '--spacing': '0.2rem' } as CSSProperties

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
  dndDisabled: boolean
  dragConversations: (keys: Set<Key>) => Record<string, string>[]
  moveDropped: (items: DropItem[], projectId: string | null) => Promise<void>
  renderConversation: (conv: ConversationInfoResponse) => ReactNode
  /** This group's hook-gate transcripts, folded under its own rows. */
  reviewConversations: ConversationInfoResponse[]
  reviewsExpanded: boolean
  onToggleReviewsExpanded: () => void
  archivedConversations: ConversationInfoResponse[]
  archivedExpanded: boolean
  onToggleArchivedExpanded: () => void
}

/**
 * A set of rows folded away under the group — reviews, archived — behind one
 * row whose label is the count. One menu holds the toggle and, once opened,
 * the rows: two menus with the same name would be two tree grids a screen
 * reader cannot tell apart. No drag hooks, on purpose: what is in here is
 * filed where its hook or its archiving left it.
 */
function FoldedMenu({
  id,
  icon,
  label,
  expanded,
  onToggle,
  children,
}: {
  id: string
  icon: ReactNode
  label: string
  expanded: boolean
  onToggle: () => void
  /** The rows, drawn only while expanded. */
  children: ReactNode
}) {
  return (
    <Sidebar.Menu aria-label={label}>
      <Sidebar.MenuItem id={id} textValue={label} onAction={onToggle}>
        <Sidebar.MenuIcon>{icon}</Sidebar.MenuIcon>
        <Sidebar.MenuLabel className="text-muted text-xs">{label}</Sidebar.MenuLabel>
        <Sidebar.MenuChip>
          <ChevronRight className={cn('size-3 text-muted transition-transform', expanded && 'rotate-90')} />
        </Sidebar.MenuChip>
      </Sidebar.MenuItem>
      {expanded && children}
    </Sidebar.Menu>
  )
}

/**
 * One group: a header that is the project's whole surface, and a flat menu of
 * its conversations. A component rather than a render function because each
 * group owns a `useDragAndDrop` of its own — the hooks carry the group's
 * project id in their drop handlers, and hooks cannot be called in a loop.
 *
 * The header is a `DropZone`, not a collection row: React Aria registers it
 * with the same drag manager the tree hooks use, so a drag started on a
 * conversation row can land here — including on a folded group, and on an
 * empty project, which renders no menu and has no other surface a drop could
 * find. Dropping a conversation on its own group is `moveDropped`'s no-op.
 */
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
  dndDisabled,
  dragConversations,
  moveDropped,
  renderConversation,
  reviewConversations,
  reviewsExpanded,
  onToggleReviewsExpanded,
  archivedConversations,
  archivedExpanded,
  onToggleArchivedExpanded,
}: ConversationGroupProps) {
  const { t } = useTranslation()

  // Drops on this group's rows and on its background both mean "file here":
  // with flat per-project menus the rows carry no destination of their own, so
  // the whole list is one fat target. Insertion drops stay rejected — there is
  // no `onInsert` — because the order inside a group is pinned state and
  // recency, not something a person arranges.
  const { dragAndDropHooks } = useDragAndDrop({
    isDisabled: dndDisabled,
    getItems: dragConversations,
    // 'move' first — the in-sidebar drops keep their refiling semantics — and
    // 'copy' beside it so the chat column's DropZone can accept the same drag
    // as a citation. A drop target picks the first operation both sides allow.
    getAllowedDropOperations: () => ['move', 'copy'],
    acceptedDragTypes: [CONVERSATION_DRAG_TYPE],
    shouldAcceptItemDrop: () => true,
    onItemDrop: (e) => void moveDropped(e.items, projectId),
    onRootDrop: (e) => void moveDropped(e.items, projectId),
  })

  const moreLabel = t('sidebar.moreActions', { name: title })
  return (
    <Sidebar.Group>
      <Sidebar.GroupLabel className="flex">
        <DropZone
          aria-label={projectId ? t('sidebar.moveInto', { name: title }) : t('sidebar.moveOut')}
          getDropOperation={(types) => (acceptsConversationDrop(types) ? 'move' : 'cancel')}
          onDrop={(e) => void moveDropped(e.items, projectId)}
          className="sidebar-group-drop min-w-0 flex-1 rounded-md"
        >
          {/* The row-hit attributes sit on this inner div, not on the zone:
              `recordHit` walks `closest('[data-row-id]')` from wherever the
              right-click landed, and the zone's own element is replaced
              wholesale by React Aria's render props. The loose group carries
              none — it has no actions a context menu could offer. */}
          <div
            data-slot="sidebar-group-header"
            className="flex min-w-0 items-center gap-0.5"
            data-row-id={projectId ?? undefined}
            data-row-kind={projectId ? 'project' : undefined}
          >
            <TooltipTrigger delay={0}>
              <Button
                iconOnly
                size="small"
                variant="ghost"
                aria-expanded={!folded}
                aria-label={
                  folded ? t('sidebar.unfoldGroup', { name: title }) : t('sidebar.foldGroup', { name: title })
                }
                onPress={onToggleFold}
                className="touch-hitbox size-5 shrink-0 rounded-md text-muted"
              >
                <ChevronRight className={cn('size-3 transition-transform', !folded && 'rotate-90')} />
              </Button>
              <Tooltip>
                {folded ? t('sidebar.unfoldGroup', { name: title }) : t('sidebar.foldGroup', { name: title })}
              </Tooltip>
            </TooltipTrigger>
            {onSelectToggle ? (
              <ToggleButton
                size="small"
                variant="ghost"
                onChange={onSelectToggle}
                // The selection this toggles decides where a new conversation
                // files and which workspace the empty state reads — state, so
                // `aria-pressed` rather than `aria-current`.
                isSelected={isCurrent}
                className={cn(
                  'h-6 min-w-0 flex-1 justify-start rounded-sm px-1 text-xs font-medium',
                  isCurrent ? 'text-foreground' : 'text-muted',
                )}
              >
                <span data-slot="sidebar-group-title" className="truncate">
                  {title}
                </span>
              </ToggleButton>
            ) : (
              <span data-slot="sidebar-group-title" className="min-w-0 flex-1 truncate px-1">
                {title}
              </span>
            )}
            <span data-slot="sidebar-group-actions" className="sidebar-group-actions flex shrink-0 items-center">
              <TooltipTrigger delay={0}>
                <Button
                  iconOnly
                  size="small"
                  variant="ghost"
                  aria-label={projectId ? t('sidebar.newConversationIn', { name: title }) : t('sidebar.newChat')}
                  onPress={onNewConversation}
                  className="touch-hitbox size-6 rounded-md text-muted"
                >
                  <Plus />
                </Button>
                <Tooltip>{projectId ? t('sidebar.newConversationIn', { name: title }) : t('sidebar.newChat')}</Tooltip>
              </TooltipTrigger>
              {actions && actions.length > 0 && (
                <Dropdown>
                  {/* Styled as a menu action — the docs' own pattern for a
                      dropdown trigger in a sidebar — so the two buttons match. */}
                  <TooltipTrigger delay={0}>
                    <Sidebar.MenuAction className="touch-hitbox" aria-label={moreLabel}>
                      <EllipsisVertical className="size-4" />
                    </Sidebar.MenuAction>
                    <Tooltip>{moreLabel}</Tooltip>
                  </TooltipTrigger>
                  <DropdownPopover placement="bottom end" aria-label={moreLabel}>
                    <RowActionDropdownItems actions={actions} />
                  </DropdownPopover>
                </Dropdown>
              )}
            </span>
          </div>
        </DropZone>
      </Sidebar.GroupLabel>
      {!folded && conversations.length > 0 && (
        <Sidebar.Menu aria-label={title} dragAndDropHooks={dragAndDropHooks}>
          {conversations.map(renderConversation)}
        </Sidebar.Menu>
      )}
      {/* Reviews before archived: a review is live work on this project, an
          archived conversation is over. Neither list is a drop target — the
          rows carry the drag hooks of the menu above, and a review is filed
          where its hook filed it. */}
      {!folded && reviewConversations.length > 0 && (
        <FoldedMenu
          id={`reviews-toggle-${projectId ?? 'loose'}`}
          icon={<CodePullRequestCheck />}
          label={t('sidebar.reviewsCount', { count: reviewConversations.length })}
          expanded={reviewsExpanded}
          onToggle={onToggleReviewsExpanded}
        >
          {reviewConversations.map(renderConversation)}
        </FoldedMenu>
      )}
      {!folded && archivedConversations.length > 0 && (
        <FoldedMenu
          id={`archived-toggle-${projectId ?? 'loose'}`}
          icon={<Archive />}
          label={t('sidebar.archivedCount', { count: archivedConversations.length })}
          expanded={archivedExpanded}
          onToggle={onToggleArchivedExpanded}
        >
          {archivedConversations.map(renderConversation)}
        </FoldedMenu>
      )}
    </Sidebar.Group>
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
}: AppSidebarProps) {
  const { t, i18n } = useTranslation()
  const platform = usePlatform()
  const relativeTime = useRelativeTime()
  /**
   * Whether the machine that would run the adapter can run one.
   *
   * A session is a child process and Android has none — the commands are
   * compiled out there — so on a phone answering for itself these rows can only
   * fail. **But in remote mode the phone is not the machine that would run
   * it.** The turn runs on the host, the four ACP commands are declared
   * remote-reachable for exactly that reason, and the directory the picker
   * offers is the host's. Reading the local platform in that case hid a feature
   * that works, which is what this used to do and called conservative.
   */
  const canHostSessions = platform !== 'android' || isRemote
  const { isMobileOpen, setMobileOpen, isOpen, isMobile, collapsible } = useSidebar()
  // Pro's own rail test, verbatim: the desktop panel is an icon rail only
  // under `collapsible="icon"`, and the mobile sheet is never one.
  const isIconCollapsed = collapsible === 'icon' && !isMobile && !isOpen
  const [showNewProject, setShowNewProject] = useState(false)
  const [showNewHosted, setShowNewHosted] = useState(false)
  // Held here because `settingsSide`/`chatSide` below are rendered twice under
  // 768px — once as the hidden panel, once as the sheet. See `useDraft`.
  const projectDraft = useDraft()
  const projectCreation = useProjectCreation()
  const hostedDraft = useDraft()
  const hostedLaunch = useHostedLaunch()
  /** The session picker, and which of its two jobs it is doing. `attach`
   *  carries the conversation being repointed. */
  const [picker, setPicker] = useState<{ mode: 'import' | 'attach'; conversationId?: string } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ type: 'conversation' | 'project'; id: string } | null>(null)
  /** The conversation the move-to-project dialog is open for. */
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [movePending, setMovePending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [archivedConversations, setArchivedConversations] = useState<ConversationInfoResponse[]>([])
  const archivedLoaded = useRef(false)
  const [expandedArchivedGroups, setExpandedArchivedGroups] = useState<Set<string | null>>(new Set())
  const { confirm, confirmDialog } = useConfirm()

  const loadArchived = useCallback(async () => {
    const archived = await api.listConversations(true)
    setArchivedConversations(archived)
    archivedLoaded.current = true
  }, [])

  // Load on mount so the toggle is visible from the start, and reload whenever
  // the active conversation list changes (an archive/unarchive shifts a row
  // between the two lists).
  useEffect(() => {
    void loadArchived()
  }, [conversations, loadArchived])

  const archivedByProject = useMemo(() => {
    const map = new Map<string | null, ConversationInfoResponse[]>()
    for (const conv of archivedConversations) {
      const key = conv.project_id ?? null
      const list = map.get(key)
      if (list) list.push(conv)
      else map.set(key, [conv])
    }
    return map
  }, [archivedConversations])

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

  // Which groups have their reviews unfolded. Shut by default, for the reason
  // `REVIEW_KINDS` gives; in-memory only, like the group folds.
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
  const openSearch = dismissing(onOpenSearch)
  const openSettings = dismissing(onOpenSettings)
  const closeSettings = dismissing(onCloseSettings)
  const changeSettingsTab = dismissing(onSettingsTabChange)

  // One menu per copy of the sidebar rather than one per group or per row. A
  // row cannot be the trigger: `Sidebar.Menu` is a React Aria `Tree`, whose
  // items pass only a fixed set of DOM props through — `onContextMenu` is not
  // among them — and anything inserted between the tree and its items is not a
  // collection item at all. So the trigger wraps all of the groups and the row
  // is read back off the event, which also leaves one popover behind where
  // there used to be one per conversation.
  //
  // `open` is controlled because a click that lands between rows has to be
  // refused, and the hit is a ref because that decision is taken inside
  // `onOpenChange`, which runs before a state update from the same event is
  // visible. The scope is part of it because the groups below are rendered
  // twice — once for the panel, once for the mobile sheet — and only the copy
  // that was right-clicked may open.
  const hitRef = useRef<MenuHit | null>(null)
  const [menu, setMenu] = useState<MenuHit | null>(null)

  const { filed, loose, reviews } = useMemo(() => groupByProject(conversations), [conversations])
  const projectNameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const exactTime = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.resolvedLanguage, i18n.language],
  )

  // Which groups are folded shut, keyed by project id (`LOOSE_KEY` for the
  // loose group). Inverted from the tree this replaces on purpose: a group
  // starts open — the example's look — and folding is the opt-out, so a new
  // project needs no bookkeeping to appear expanded. In-memory only, same as
  // the tree's set was.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set<string>())
  const toggleFold = useCallback((key: string) => {
    setFolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  // Whatever is on screen has its group opened for it. A conversation reached
  // from anywhere but this list — the command palette, a notification — would
  // otherwise be current inside a group folded shut.
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
  // The same for the review fold: a review opened from a toast or the palette
  // is current inside a fold that is shut.
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

  /**
   * Dragging a conversation onto where it should live, beside the dialog
   * rather than instead of it.
   *
   * Disabled where the primary pointer is a finger: there a long press is
   * already the way to a row's actions, and a drag gesture on the same fuse
   * would fight it — the dialog is the touch path. `getItems` is shared by
   * every group's hooks (the keys differ only by prefix, which `sidebar-dnd`
   * parses around); the hooks themselves are per group, because each carries
   * its own destination.
   */
  const dndDisabled = isCoarsePointer()

  /** What a dragged row carries. A row that is not a conversation carries
   *  nothing, and a drag with no payload has nowhere it can be dropped. */
  const dragConversations = useCallback(
    (keys: Set<Key>) =>
      [...keys].flatMap((key) => {
        const id = conversationIdOf(String(key))
        return id ? [{ [CONVERSATION_DRAG_TYPE]: id }] : []
      }),
    [],
  )

  const moveDropped = useCallback(
    async (items: DropItem[], projectId: string | null) => {
      for (const item of items) {
        if (item.kind !== 'text' || !item.types.has(CONVERSATION_DRAG_TYPE)) continue
        const id = await item.getText(CONVERSATION_DRAG_TYPE)
        if (!id) continue
        // Dropping a conversation where it already lives is a no-op, not a
        // write: the move bumps `updated_at`, which would resort the sidebar
        // over a drag that changed nothing.
        const current = conversations.find((c) => c.id === id)?.project_id ?? null
        if (current === projectId) continue
        const failure = await onMoveToProject(id, projectId)
        if (failure) {
          // A drag has no surface of its own. Reopen the same dialog used by
          // row actions so the refusal is visible and can be retried.
          setMoveTarget(id)
          setMoveError(failure)
          return
        }
      }
    },
    [conversations, onMoveToProject],
  )

  const conversationActions = useConversationActions({
    onTogglePin,
    onToggleArchive,
    onRequestRename: (id) => setRenameTarget({ type: 'conversation', id }),
    onRequestMove: (id) => {
      setMoveError(null)
      setMoveTarget(id)
    },
    onExportError: (error) => setActionError(t('sidebar.exportFailed', { error: String(error) })),
    onRequestDelete: async (id) => {
      if (await confirm({ body: t('confirm.deleteConversation') })) onDelete(id)
    },
    // Only where there is an agent session to point at, and only where a
    // session can exist at all — Android has no child processes, so the
    // commands behind this are compiled out there.
    //
    // Through `dismissing` like every other row action that opens something
    // outside the sheet: this one puts up a full-screen dialog rather than a
    // surface inside the sheet, so leaving the sheet open would stack the two
    // and closing the dialog would land back on the sheet.
    onRequestAttachSession: canHostSessions
      ? (id: string) => dismissing(() => setPicker({ mode: 'attach', conversationId: id }))()
      : undefined,
  })
  const projectActions = useProjectActions({
    onRequestRename: (id) => setRenameTarget({ type: 'project', id }),
    onRequestDelete: async (id) => {
      if (await confirm({ body: t('confirm.deleteProject') })) onDeleteProject(id)
    },
  })

  // Only the right-click menu needs to know which row was hit; the button on a
  // row already knows. Which *kind* of row it was is read off the DOM too:
  // a conversation row and a project's group header live under one trigger, so
  // the list a click landed in no longer says what was clicked.
  const hitConversation =
    menu?.kind === 'conversation'
      ? (conversations.find((c) => c.id === menu.id) ?? archivedConversations.find((c) => c.id === menu.id))
      : undefined
  const hitProject = menu?.kind === 'project' ? projects.find((p) => p.id === menu.id) : undefined
  const hitActions = hitConversation
    ? conversationActions(hitConversation)
    : hitProject
      ? projectActions(hitProject)
      : []

  const recordHit = useCallback((scope: string, target: EventTarget | null) => {
    const row = (target as HTMLElement | null)?.closest('[data-row-id]')
    const id = row?.getAttribute('data-row-id')
    const kind = row?.getAttribute('data-row-kind') as MenuHit['kind'] | null | undefined
    hitRef.current = id && kind ? { scope, kind, id } : null
  }, [])

  // The menu is named for the row it was opened on — the same string as the
  // row's own actions button, so a screen reader hears one name for both.
  const hitLabel = t('sidebar.moreActions', { name: hitConversation?.title ?? hitProject?.name ?? '' })

  // The Trigger reads the cursor position through the Root's context, whose
  // default `handleOpen` is a no-op — so a Root parked next to the dialogs at
  // the bottom of this component renders fine and simply never opens, which
  // neither the type checker nor the build notices.
  const rowMenu = useCallback(
    (scope: string, actions: RowAction[], children: React.ReactNode) => (
      <ContextMenu open={menu?.scope === scope} onOpenChange={(open) => setMenu(open ? hitRef.current : null)}>
        {/* Recorded on `pointerdown` as well as on `contextmenu`, because the
            two ways this menu opens do not agree on which event comes first. A
            right-click fires `contextmenu` and Pro opens from it; a touch
            starts Pro's own 500ms long-press timer, and the WebView's native
            `contextmenu` is on roughly the same fuse. Whichever wins, the
            controlled `open` below reads `hitRef` — and read before the row was
            recorded it is null, so the menu is asked to open with nothing
            selected and silently does not. `pointerdown` precedes both.

            The capture variant, and not `onContextMenu`: the Trigger spreads
            its props *after* its own handlers, so a bubbling handler here would
            replace the one that opens the menu. `block`, because Pro's trigger
            is `inline-block` and this one wraps the whole list. */}
        <ContextMenu.Trigger
          className="block"
          onPointerDown={(e: React.PointerEvent) => recordHit(scope, e.target)}
          onContextMenuCapture={(e: React.MouseEvent) => recordHit(scope, e.target)}
        >
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Popover>
          <ContextMenu.Menu aria-label={hitLabel}>
            <RowActionItems actions={actions} />
          </ContextMenu.Menu>
        </ContextMenu.Popover>
      </ContextMenu>
    ),
    [menu, recordHit, hitLabel],
  )

  const renaming =
    renameTarget?.type === 'project'
      ? projects.find((p) => p.id === renameTarget.id)?.name
      : ((
          conversations.find((c) => c.id === renameTarget?.id) ??
          archivedConversations.find((c) => c.id === renameTarget?.id)
        )?.title ?? '')

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
   * One conversation row, in whichever group it sits — the same row either
   * way, since the group above it says where it lives. The rich tooltip
   * carries what the compact row cannot: the untruncated title, the project,
   * and the exact time behind the relative chip.
   */
  const conversationItem = (prefix: string, conv: ConversationInfoResponse) => {
    const title = conv.title ?? t('sidebar.newChat')
    const projectName = conv.project_id ? projectNameById.get(conv.project_id) : undefined
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
        tooltipProps={{
          className: 'text-xs',
          delay: 500,
          placement: 'right',
          content: (
            <div data-slot="conversation-tooltip" className="flex flex-col gap-1">
              <span data-slot="conversation-tooltip-title" className="font-medium">
                {title}
              </span>
              <span data-slot="conversation-tooltip-meta" className="opacity-60">
                {projectName ? `${projectName} · ` : ''}
                {exactTime.format(conv.updated_at)}
              </span>
            </div>
          ),
        }}
      >
        <Sidebar.MenuIcon>
          {conv.is_archived ? <Archive /> : <ConversationIcon agentKind={conv.agent_kind} />}
        </Sidebar.MenuIcon>
        <Sidebar.MenuLabel>{title}</Sidebar.MenuLabel>
        {/* React Aria's Tree drag contract is a real button, not merely a
            draggable row. It is the keyboard and screen-reader entry point;
            pointer users may still drag the row itself. Hidden on coarse
            pointers because DnD is disabled there and the row-actions dialog
            is the touch path; on fine pointers it appears on hover, the way a
            file tree's handle does — see `conv-grip` in `index.css`. */}
        <TooltipTrigger delay={0}>
          <Sidebar.MenuAction
            slot="drag"
            aria-label={t('sidebar.dragConversation', { name: title })}
            className="conv-grip hidden pointer-fine:flex cursor-grab active:cursor-grabbing"
          >
            <Grip />
          </Sidebar.MenuAction>
          <Tooltip>{t('sidebar.dragConversation', { name: title })}</Tooltip>
        </TooltipTrigger>
        <Sidebar.MenuChip className="gap-1">
          {/* Hover swaps this for the action buttons — see `conv-time`. */}
          <span data-slot="conversation-time" className="conv-time">
            {relativeTime(conv.updated_at)}
          </span>
          {/* Pinned rows were sorted to the top and said nothing about why they
              were there. */}
          {conv.is_pinned && <Pin aria-label={t('contextMenu.pin')} className="size-3 text-muted" />}
          <ConversationIndicator conversationId={conv.id} activeId={activeId} transcriptInert={page === 'settings'} />
        </Sidebar.MenuChip>
        <RowActionsMenu label={title} actions={conversationActions(conv)} />
      </Sidebar.MenuItem>
    )
  }

  const searchShortcut = platform === null ? 'Ctrl/⌘ K' : platform === 'macos' || platform === 'ios' ? '⌘ K' : 'Ctrl K'

  const chatSide = (prefix: string, collapsed: boolean) => (
    <>
      <Sidebar.Header>
        <Sidebar.Menu aria-label={t('sidebar.newChat')}>
          {/* One row for all three ways a conversation comes into being. The
              row itself is the common one — a click is a new chat — and the
              two hosted ways live in the row's own menu, the same affordance
              every conversation row already carries. */}
          <Sidebar.MenuItem id={`${prefix}new`} textValue={t('sidebar.newChat')} onAction={() => createConversation()}>
            <Sidebar.MenuIcon>
              <Plus />
            </Sidebar.MenuIcon>
            <Sidebar.MenuLabel>{t('sidebar.newChat')}</Sidebar.MenuLabel>
            {/* See `canHostSessions`: the question is what the machine running
                the adapter can do, which in remote mode is not this one. */}
            {canHostSessions && (
              <Sidebar.MenuActions>
                <Dropdown>
                  <TooltipTrigger delay={0}>
                    <Sidebar.MenuAction className="touch-hitbox" aria-label={t('sidebar.newChatMore')}>
                      <EllipsisVertical />
                    </Sidebar.MenuAction>
                    <Tooltip>{t('sidebar.newChatMore')}</Tooltip>
                  </TooltipTrigger>
                  <DropdownPopover placement="bottom end" aria-label={t('sidebar.newChatMore')}>
                    <DropdownItem
                      id="new-hosted"
                      textValue={t('sidebar.newHostedSession')}
                      onAction={() => setShowNewHosted((open) => !open)}
                    >
                      <Terminal className="size-4" />
                      <Label>{t('sidebar.newHostedSession')}</Label>
                    </DropdownItem>
                    {/* Beside starting one, because it is the other way a
                        hosted conversation comes into being — and the more
                        common one for anybody who already has terminals
                        open. Also the one that works best from a phone: the
                        list and the directories in it are the host's, so
                        nothing here needs a local file picker. */}
                    <DropdownItem
                      id="import-hosted"
                      textValue={t('sidebar.importHostedSession')}
                      onAction={dismissing(() => setPicker({ mode: 'import' }))}
                    >
                      <ArrowDownToSquare className="size-4" />
                      <Label>{t('sidebar.importHostedSession')}</Label>
                    </DropdownItem>
                  </DropdownPopover>
                </Dropdown>
              </Sidebar.MenuActions>
            )}
          </Sidebar.MenuItem>
          {/* The palette's third door, and the sheet's only one: a phone has
              no `mod` key to press and no header button while the sheet is
              open. The chip writes the shortcut down where a desktop reader
              will look for it; Pro hides it in the rail on its own. */}
          <Sidebar.MenuItem id={`${prefix}search`} textValue={t('sidebar.search')} onAction={openSearch}>
            <Sidebar.MenuIcon>
              <Magnifier />
            </Sidebar.MenuIcon>
            <Sidebar.MenuLabel>{t('sidebar.search')}</Sidebar.MenuLabel>
            <Sidebar.MenuChip>
              <span data-slot="sidebar-search-shortcut">{searchShortcut}</span>
            </Sidebar.MenuChip>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
        {showNewHosted && (
          <NewHostedSessionForm
            draft={hostedDraft}
            launch={hostedLaunch}
            onSubmit={async (cwd) => {
              const failure = await onCreateHostedSession(cwd)
              // Left open on failure so the reason has somewhere to be read.
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
      </Sidebar.Header>

      <Sidebar.Content>
        {/* Nothing below the header exists in the icon rail. Pro would keep
            every conversation row as an anonymous icon — the group labels are
            `display: none` there, so the rows lose the only thing that told
            them apart — and a column of identical chat icons crowds out the
            rail's real destinations. A conversation is reached through the
            reopened panel or the palette either way. */}
        {!collapsed &&
          rowMenu(
            `${prefix}groups`,
            hitActions,
            <>
              {projects.map((project) => (
                <ConversationGroup
                  key={project.id}
                  projectId={project.id}
                  title={project.name}
                  isCurrent={project.id === activeProjectId}
                  folded={folded.has(project.id)}
                  conversations={filed.get(project.id) ?? []}
                  onToggleFold={() => toggleFold(project.id)}
                  // Toggling, because the "all projects" row this list used to
                  // open with is gone: deselecting the current project is the
                  // only way left to say "no project".
                  onSelectToggle={() => selectProject(project.id === activeProjectId ? null : project.id)}
                  onNewConversation={() => createConversation(project.id)}
                  actions={projectActions(project)}
                  dndDisabled={dndDisabled}
                  dragConversations={dragConversations}
                  moveDropped={moveDropped}
                  renderConversation={(conv) => conversationItem(prefix, conv)}
                  reviewConversations={reviews.get(project.id) ?? []}
                  reviewsExpanded={expandedReviewGroups.has(project.id)}
                  onToggleReviewsExpanded={() => toggleReviewGroup(project.id)}
                  archivedConversations={archivedByProject.get(project.id) ?? []}
                  archivedExpanded={expandedArchivedGroups.has(project.id)}
                  onToggleArchivedExpanded={() => toggleArchivedGroup(project.id)}
                />
              ))}
              {/* The conversations belonging to no project. Always rendered,
                  even empty: its header is the drop that unfiles, and hiding
                  it when everything is filed would leave dragging *out* of a
                  project with nowhere to land. */}
              <ConversationGroup
                projectId={null}
                title={t('sidebar.conversations')}
                isCurrent={false}
                folded={folded.has(LOOSE_KEY)}
                conversations={loose}
                onToggleFold={() => toggleFold(LOOSE_KEY)}
                onNewConversation={() => createConversation(null)}
                dndDisabled={dndDisabled}
                dragConversations={dragConversations}
                moveDropped={moveDropped}
                renderConversation={(conv) => conversationItem(prefix, conv)}
                reviewConversations={reviews.get(null) ?? []}
                reviewsExpanded={expandedReviewGroups.has(null)}
                onToggleReviewsExpanded={() => toggleReviewGroup(null)}
                archivedConversations={archivedByProject.get(null) ?? []}
                archivedExpanded={expandedArchivedGroups.has(null)}
                onToggleArchivedExpanded={() => toggleArchivedGroup(null)}
              />
              <Sidebar.Group>
                <Sidebar.Menu aria-label={t('sidebar.newProject')}>
                  <Sidebar.MenuItem
                    id={`${prefix}new-project`}
                    textValue={t('sidebar.newProject')}
                    onAction={() => setShowNewProject(true)}
                  >
                    <Sidebar.MenuIcon>
                      <FolderPlus />
                    </Sidebar.MenuIcon>
                    <Sidebar.MenuLabel className="text-muted">{t('sidebar.newProject')}</Sidebar.MenuLabel>
                  </Sidebar.MenuItem>
                </Sidebar.Menu>
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
              </Sidebar.Group>
            </>,
          )}
      </Sidebar.Content>

      <Sidebar.Footer>
        {actionError && (
          <Alert status="danger" role="alert" data-slot="sidebar-action-error">
            <Alert.Indicator />
            <Alert.Content className="min-w-0">
              <Alert.Description className="break-words">{actionError}</Alert.Description>
            </Alert.Content>
            <TooltipTrigger delay={0}>
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
              <Tooltip>{t('common.close')}</Tooltip>
            </TooltipTrigger>
          </Alert>
        )}
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
  // `collapsed` is per copy, not global: only the desktop panel has an icon
  // rail. The mobile sheet is either fully open or not rendered, so its groups
  // never need to fold away.
  const side = (prefix: string, collapsed: boolean) => (
    <Fragment key={page === 'settings' ? 'settings' : 'chat'}>
      {page === 'settings' ? settingsSide(prefix) : chatSide(prefix, collapsed)}
    </Fragment>
  )

  return (
    <>
      {/* The safe-area padding sits on the panel rather than on its header and
          footer: `[data-state=collapsed] .sidebar__header` sets its own inline
          padding at a specificity a utility cannot reach, so a cutout would be
          honoured until the sidebar was collapsed and then quietly stop being. */}
      <Sidebar
        style={page === 'settings' ? undefined : DENSITY}
        className="pt-[var(--safe-top)] pb-[var(--safe-bottom)] pl-[var(--safe-left)]"
      >
        {side('d-', isIconCollapsed)}
      </Sidebar>
      {/* Renders nothing above 768px. Below it Pro hides the panel outright, so
          without this a narrow window would have a toggle that toggles nothing.
          The sheet covers the full height including the cutout and the
          navigation bar, and it is a separate element from the panel above, so
          it needs its own copy of the insets rather than inheriting them. */}
      <Sidebar.Mobile className="pt-[var(--safe-top)] pb-[var(--safe-bottom)] pl-[var(--safe-left)]">
        {side('m-', false)}
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

      {/* One instance for both jobs, mounted only while it is open: it fetches
          on mount and the list is a process start, not a query. */}
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
