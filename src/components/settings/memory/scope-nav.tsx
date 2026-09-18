import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin, PersonXmark } from '@gravity-ui/icons'
import { api } from '@/api'
import { Button, Card } from '@/components/base'
import { useConfirm } from '@/hooks/use-confirm'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { cn } from '@/lib/utils'
import type { MemorySubjectInfoResponse, ProjectInfoResponse } from '@/types'
import type { ScopeFilter } from './use-memory-browser'

/** How many projects or people a branch shows before offering the rest. */
const COLLAPSED_BRANCH = 8

interface ScopeNavProps {
  filter: ScopeFilter
  onFilterChange: (f: ScopeFilter) => void
  counts: { all: number; clientGlobal: number; global: number; chats: number; people: number }
  projects: ProjectInfoResponse[]
  subjects: MemorySubjectInfoResponse[]
  onChanged: () => void
}

/**
 * A filter, not a tree: the branches are mutually exclusive, which keeps the
 * selection a single value instead of a set of expanded nodes crossed with a
 * set of checked ones.
 */
export function ScopeNav({ filter, onFilterChange, counts, projects, subjects, onChanged }: ScopeNavProps) {
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const relativeTime = useRelativeTime()

  const [allProjects, setAllProjects] = useState(false)
  const [allSubjects, setAllSubjects] = useState(false)

  const selectedPerson = filter.kind === 'person' ? subjects.find((s) => s.scope_id === filter.scopeId) : undefined

  const visibleProjects = allProjects ? projects : projects.slice(0, COLLAPSED_BRANCH)
  const visibleSubjects = allSubjects ? subjects : subjects.slice(0, COLLAPSED_BRANCH)

  /**
   * `id` rather than the label as the key: two projects, or two people whose
   * display names match, would otherwise collide.
   *
   * `aria-pressed` carries the selection. The variant swap says which row is
   * current to anyone looking at it, and said it to nobody else.
   */
  const row = ({
    id,
    active,
    label,
    count = null,
    onPress,
    indent = false,
  }: {
    id: string
    active: boolean
    label: string
    count?: number | null
    onPress: () => void
    indent?: boolean
  }) => (
    <Button
      key={id}
      aria-pressed={active}
      variant={active ? 'secondary' : 'ghost'}
      className={cn('w-full justify-between font-normal', indent && 'pl-6')}
      onClick={onPress}
      data-slot="memory-scope-row"
    >
      <span data-slot="memory-scope-row-label" className="truncate">
        {label}
      </span>
      {count !== null && (
        <span data-slot="memory-scope-row-count" className="text-xs text-muted">
          {count}
        </span>
      )}
    </Button>
  )

  /**
   * The branches used to stop at eight with nothing after them — a ninth
   * project's memories were in the database and unreachable from here.
   */
  const moreRow = (slot: string, expanded: boolean, total: number, onToggle: () => void) => (
    <Button
      key={`${slot}-more`}
      variant="ghost"
      className="w-full justify-start pl-6 text-xs font-normal text-muted"
      onClick={onToggle}
      data-slot={slot}
    >
      {expanded ? t('settings.memory.nav.showLess') : t('settings.memory.nav.showAll', { count: total })}
    </Button>
  )

  return (
    // Full width until there is room for a column beside the list. Fixed at
    // 14rem, this left 88px for the memories on a 360px screen — the scope
    // picker was taking the whole screen and calling it a sidebar.
    //
    // Same container and same stop as the `flex-row` rule in `memory-settings`,
    // and they have to stay that way: on different stops there is a width where
    // this is 224px wide inside a column layout, lying across the list.
    <div data-slot="memory-scope-nav" className="flex w-full shrink-0 flex-col gap-0.5 @xl/pane:w-56">
      <div data-slot="memory-scope-nav-title" className="px-2 pb-1 text-xs font-medium text-muted">
        {t('settings.memory.nav.scope')}
      </div>

      {row({
        id: 'all',
        active: filter.kind === 'all',
        label: t('settings.memory.nav.all'),
        count: counts.all,
        onPress: () => onFilterChange({ kind: 'all' }),
      })}
      {row({
        id: 'clientGlobal',
        active: filter.kind === 'clientGlobal',
        label: t('settings.memory.nav.clientGlobal'),
        count: counts.clientGlobal,
        onPress: () => onFilterChange({ kind: 'clientGlobal' }),
      })}
      {row({
        id: 'global',
        active: filter.kind === 'global',
        label: t('settings.memory.nav.global'),
        count: counts.global,
        onPress: () => onFilterChange({ kind: 'global' }),
      })}
      {row({
        id: 'chats',
        active: filter.kind === 'chats',
        label: t('settings.memory.nav.chats'),
        count: counts.chats,
        onPress: () => onFilterChange({ kind: 'chats' }),
      })}
      {visibleProjects.map((p) =>
        row({
          id: `project:${p.id}`,
          active: filter.kind === 'project' && filter.projectId === p.id,
          label: p.name,
          onPress: () => onFilterChange({ kind: 'project', projectId: p.id }),
          indent: true,
        }),
      )}
      {projects.length > COLLAPSED_BRANCH &&
        moreRow('memory-scope-more-projects', allProjects, projects.length, () => setAllProjects((v) => !v))}
      {row({
        id: 'people',
        active: filter.kind === 'people',
        label: t('settings.memory.nav.people'),
        count: counts.people,
        onPress: () => onFilterChange({ kind: 'people' }),
      })}
      {visibleSubjects.map((s) =>
        row({
          id: `person:${s.scope_id}`,
          active: filter.kind === 'person' && filter.scopeId === s.scope_id,
          label: s.display_name ?? s.scope_id,
          onPress: () => onFilterChange({ kind: 'person', scopeId: s.scope_id }),
          indent: true,
        }),
      )}
      {subjects.length > COLLAPSED_BRANCH &&
        moreRow('memory-scope-more-people', allSubjects, subjects.length, () => setAllSubjects((v) => !v))}

      {selectedPerson && (
        <Card data-slot="memory-person-card" className="mt-3">
          <Card.Header>
            <Card.Title>{selectedPerson.display_name ?? selectedPerson.scope_id}</Card.Title>
            <Card.Description>
              {t('settings.memory.person.lastSeen', {
                when: relativeTime(selectedPerson.last_seen_at),
              })}
            </Card.Description>
          </Card.Header>
          {selectedPerson.opted_out && (
            <div data-slot="memory-person-opted-out" className="text-xs text-warning-soft-foreground">
              {t('settings.memory.person.optedOut')}
            </div>
          )}

          <Button
            variant="ghost"
            className="w-full justify-start font-normal"
            onClick={async () => {
              await api.setMemorySubjectFlags({
                subjectScopeId: selectedPerson.scope_id,
                isPinned: !selectedPerson.is_pinned,
                optedOut: null,
              })
              onChanged()
            }}
            data-slot="memory-pin-toggle"
          >
            <Pin className={selectedPerson.is_pinned ? 'text-foreground' : 'text-muted'} />
            {selectedPerson.is_pinned ? t('settings.memory.unpin') : t('settings.memory.pin')}
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start font-normal"
            onClick={async () => {
              const ok = await confirm({
                title: t('settings.memory.person.forgetConfirmTitle'),
                body: t('settings.memory.person.forgetConfirmBody'),
              })
              if (!ok) return
              await api.forgetMemorySubject(selectedPerson.scope_id)
              onChanged()
            }}
          >
            <PersonXmark className="text-danger" />
            {t('settings.memory.person.forget')}
          </Button>
        </Card>
      )}
      {confirmDialog}
    </div>
  )
}
