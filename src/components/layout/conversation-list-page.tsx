import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, Button, Disclosure } from '@heroui/react'
import { Archive, Comment, Ellipsis, FolderOpen, Gear, Pin, Plus } from '@gravity-ui/icons'

import { cn } from '@/lib/utils'
import { formatListTimestamp } from '@/lib/format-time'
import type { Conversation, Project } from '@/types'
import { ActionSheet } from './action-sheet'
import { ConversationIndicator } from './conversation-indicator'
import { MobileAppBar } from './mobile-app-bar'
import { ProjectIcon } from './project-icon'
import { RenameDialog } from './rename-dialog'
import { useConversationActions, useProjectActions, type RowAction } from './row-actions'

/** Which row a sheet or dialog is currently about. */
type Target = { type: 'conversation' | 'project'; id: string } | null

/**
 * The conversation list as a screen of its own.
 *
 * Self-contained on purpose: it borrows nothing from `ui/sidebar` and nothing
 * from `ui/context-menu`, both of which are on their way out. It also leaves
 * `SpotlightCard` behind — that one follows a mouse, and there is no mouse here.
 *
 * Every row is a `div` holding two buttons rather than a button holding
 * everything, which is what makes an ⋮ target legal beside a tappable row, and
 * what stops the old "an input nested inside a button" problem from following
 * the rename affordance over here.
 */
export function ConversationListPage({
  conversations,
  activeId,
  projects,
  activeProjectId,
  onSelect,
  onCreate,
  onSelectProject,
  onDelete,
  onRename,
  onTogglePin,
  onDeleteProject,
  onRenameProject,
  onBack,
  onOpenSettings,
}: {
  conversations: Conversation[]
  activeId: string | null
  projects: Project[]
  activeProjectId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onSelectProject: (id: string | null) => void
  onDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => void
  onTogglePin: (id: string) => void
  onDeleteProject: (id: string) => void
  onRenameProject: (id: string, newName: string) => void
  onBack: () => void
  onOpenSettings: () => void
}) {
  const { t, i18n } = useTranslation()
  const [sheetTarget, setSheetTarget] = useState<Target>(null)
  const [renameTarget, setRenameTarget] = useState<Target>(null)
  const [deleteTarget, setDeleteTarget] = useState<Target>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const requestRename = useCallback((type: 'conversation' | 'project') => (id: string) => {
    setRenameTarget({ type, id })
  }, [])
  const requestDelete = useCallback((type: 'conversation' | 'project') => (id: string) => {
    setDeleteTarget({ type, id })
  }, [])

  const renameSubject = useMemo(() => {
    if (!renameTarget) return null
    if (renameTarget.type === 'conversation') {
      const c = conversations.find((x) => x.id === renameTarget.id)
      return c ? { value: c.title ?? '', heading: t('sidebar.renameConversation') } : null
    }
    const p = projects.find((x) => x.id === renameTarget.id)
    return p ? { value: p.name, heading: t('sidebar.renameProject') } : null
  }, [renameTarget, conversations, projects, t])

  return (
    <div data-slot="conversation-list-page" className="flex h-full min-h-0 flex-col bg-background">
      <MobileAppBar
        title={t('sidebar.conversations')}
        backLabel={t('common.back')}
        onBack={onBack}
        actions={
          <>
            <Button
              isIconOnly
              variant="ghost"
              aria-label={t('sidebar.newChat')}
              onClick={() => { onCreate(); onBack() }}
              className="size-12 rounded-xl"
            >
              <Plus className="size-5" />
            </Button>
            <Button
              isIconOnly
              variant="ghost"
              aria-label={t('sidebar.settings')}
              onClick={onOpenSettings}
              className="size-12 rounded-xl"
            >
              <Gear className="size-5" />
            </Button>
          </>
        }
      />

      {/* The inset belongs to the scroller so the last row can come to rest
          above the navigation bar while the list still reaches the bottom of
          the screen. */}
      <div
        data-slot="conversation-list-scroll"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,var(--safe-bottom))] pl-[max(0.5rem,var(--safe-left))] pr-[max(0.5rem,var(--safe-right))]"
      >
        <Disclosure data-slot="project-section" className="border-b border-border py-1">
          <Disclosure.Trigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm">
            <FolderOpen className="size-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{t('sidebar.projects')}</span>
            <span className="shrink-0 truncate text-xs text-muted">
              {activeProject?.name ?? t('sidebar.allProjects')}
            </span>
            <Disclosure.Indicator className="size-4 shrink-0 text-muted" />
          </Disclosure.Trigger>
          <Disclosure.Content className="space-y-0.5 pb-1">
            <Row
              icon={<FolderOpen className="size-4 shrink-0 text-muted" />}
              title={t('sidebar.allProjects')}
              isActive={activeProjectId === null}
              onSelect={() => onSelectProject(null)}
            />
            {projects.map((p) => (
              <Row
                key={p.id}
                icon={<span className="flex size-4 shrink-0 items-center text-muted"><ProjectIcon sourceType={p.source_type} /></span>}
                title={p.name}
                isActive={p.id === activeProjectId}
                onSelect={() => onSelectProject(p.id)}
                onMore={() => setSheetTarget({ type: 'project', id: p.id })}
                moreLabel={t('sidebar.moreActions')}
              />
            ))}
          </Disclosure.Content>
        </Disclosure>

        <div data-slot="conversation-section" className="space-y-0.5 py-1">
          {conversations.map((conv) => (
            <Row
              key={conv.id}
              icon={conv.is_archived
                ? <Archive className="size-4 shrink-0 text-muted" />
                : <Comment className="size-4 shrink-0 text-muted" />}
              title={conv.title ?? t('sidebar.newChat')}
              isActive={conv.id === activeId}
              isDimmed={!!conv.is_archived}
              onSelect={() => onSelect(conv.id)}
              onMore={() => setSheetTarget({ type: 'conversation', id: conv.id })}
              moreLabel={t('sidebar.moreActions')}
              trailing={
                <>
                  {!!conv.is_pinned && <Pin className="size-3 shrink-0 text-muted" />}
                  <ConversationIndicator conversationId={conv.id} activeId={activeId} />
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {formatListTimestamp(conv.updated_at, i18n.language)}
                  </span>
                </>
              }
            />
          ))}
        </div>
      </div>

      <SheetHost
        target={sheetTarget}
        conversations={conversations}
        projects={projects}
        onClose={() => setSheetTarget(null)}
        onTogglePin={onTogglePin}
        onRequestRename={(type, id) => requestRename(type)(id)}
        onRequestDelete={(type, id) => requestDelete(type)(id)}
      />

      {/* Siblings of the sheet, never children of it: nested inside, closing
          the sheet would unmount them mid-flight and stack two focus traps. */}
      <RenameDialog
        isOpen={renameSubject !== null}
        onOpenChange={(open) => { if (!open) setRenameTarget(null) }}
        initialValue={renameSubject?.value ?? ''}
        heading={renameSubject?.heading ?? ''}
        onSubmit={(value) => {
          if (!renameTarget) return
          if (renameTarget.type === 'conversation') onRename(renameTarget.id, value)
          else onRenameProject(renameTarget.id, value)
          setRenameTarget(null)
        }}
      />

      <AlertDialog.Backdrop
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>{t('confirm.title')}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {deleteTarget?.type === 'project'
                ? t('confirm.deleteProject')
                : t('confirm.deleteConversation')}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="secondary">{t('common.cancel')}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (!deleteTarget) return
                  if (deleteTarget.type === 'project') onDeleteProject(deleteTarget.id)
                  else onDelete(deleteTarget.id)
                  setDeleteTarget(null)
                }}
              >
                {t('common.confirm')}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
}

/**
 * One line in either list.
 *
 * `h-*`/`px-*` and `rounded-*` are overridden together: HeroUI's button base is
 * `rounded-3xl`, and changing the height alone leaves a hover fill that gets
 * clipped at the corners of the row.
 */
function Row({
  icon,
  title,
  trailing,
  isActive,
  isDimmed,
  onSelect,
  onMore,
  moreLabel,
}: {
  icon: React.ReactNode
  title: string
  trailing?: React.ReactNode
  isActive?: boolean
  isDimmed?: boolean
  onSelect: () => void
  onMore?: () => void
  moreLabel?: string
}) {
  return (
    <div data-slot="list-row" className="flex items-center gap-1">
      <Button
        variant="ghost"
        onClick={onSelect}
        className={cn(
          'h-auto min-h-14 w-full min-w-0 flex-1 justify-start gap-2 rounded-lg px-3 py-2 font-normal',
          isActive && 'bg-default text-default-foreground',
          isDimmed && 'opacity-50',
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-start text-sm">{title}</span>
        {trailing}
      </Button>
      {onMore && (
        <Button
          isIconOnly
          variant="ghost"
          aria-label={moreLabel}
          onClick={onMore}
          className="size-9 shrink-0 rounded-lg text-muted touch-hitbox"
        >
          <Ellipsis className="size-4" />
        </Button>
      )}
    </div>
  )
}

/** Resolves the open target into a title and a set of actions. */
function SheetHost({
  target,
  conversations,
  projects,
  onClose,
  onTogglePin,
  onRequestRename,
  onRequestDelete,
}: {
  target: Target
  conversations: Conversation[]
  projects: Project[]
  onClose: () => void
  onTogglePin: (id: string) => void
  onRequestRename: (type: 'conversation' | 'project', id: string) => void
  onRequestDelete: (type: 'conversation' | 'project', id: string) => void
}) {
  const { t } = useTranslation()
  const conversation = target?.type === 'conversation'
    ? conversations.find((c) => c.id === target.id)
    : undefined
  const project = target?.type === 'project'
    ? projects.find((p) => p.id === target.id)
    : undefined

  // Both hooks run every render — only one of them has a row to describe, and
  // the other returns nothing.
  const conversationActions = useConversationActions({
    conversation: conversation ?? null,
    onTogglePin,
    onRequestRename: (id) => onRequestRename('conversation', id),
    onRequestDelete: (id) => onRequestDelete('conversation', id),
  })
  const projectActions = useProjectActions({
    project: project ?? null,
    onRequestRename: (id) => onRequestRename('project', id),
    onRequestDelete: (id) => onRequestDelete('project', id),
  })

  let title = ''
  let actions: RowAction[] = []
  if (conversation) {
    title = conversation.title ?? t('sidebar.newChat')
    actions = conversationActions
  } else if (project) {
    title = project.name
    actions = projectActions
  }

  return (
    <ActionSheet
      title={title}
      actions={actions}
      isOpen={target !== null && actions.length > 0}
      onOpenChange={(open) => { if (!open) onClose() }}
    />
  )
}
