import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin, PersonXmark } from '@gravity-ui/icons'
import { api } from '@/api'
import { Button, Card } from '@heroui/react'
import { useConfirm } from '@/hooks/use-confirm'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { cn } from '@/lib/utils'
import type { MemorySubject, Project } from '@/types'
import type { ScopeFilter } from './use-memory-browser'

/** How many projects or people a branch shows before offering the rest. */
const COLLAPSED_BRANCH = 8

interface ScopeNavProps {
  filter: ScopeFilter
  onFilterChange: (f: ScopeFilter) => void
  counts: { all: number; clientGlobal: number; global: number; chats: number; people: number }
  projects: Project[]
  subjects: MemorySubject[]
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
    onClick,
    indent = false,
  }: {
    id: string
    active: boolean
    label: string
    count?: number | null
    onClick: () => void
    indent?: boolean
  }) => (
    <Button
      key={id}
      aria-pressed={active}
      variant={active ? 'secondary' : 'ghost'}
      className={cn('w-full justify-between font-normal', indent && 'pl-6')}
      onClick={onClick}
      data-slot="memory-scope-row"
    >
      <span className="truncate">{label}</span>
      {count !== null && <span className="text-xs text-muted">{count}</span>}
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
    <div data-slot="memory-scope-nav" className="flex w-full shrink-0 flex-col gap-0.5 md:w-56">
      <div className="px-2 pb-1 text-xs font-medium text-muted">{t('settings.memory.nav.scope')}</div>

      {row({
        id: 'all',
        active: filter.kind === 'all',
        label: t('settings.memory.nav.all'),
        count: counts.all,
        onClick: () => onFilterChange({ kind: 'all' }),
      })}
      {row({
        id: 'clientGlobal',
        active: filter.kind === 'clientGlobal',
        label: t('settings.memory.nav.clientGlobal'),
        count: counts.clientGlobal,
        onClick: () => onFilterChange({ kind: 'clientGlobal' }),
      })}
      {row({
        id: 'global',
        active: filter.kind === 'global',
        label: t('settings.memory.nav.global'),
        count: counts.global,
        onClick: () => onFilterChange({ kind: 'global' }),
      })}
      {row({
        id: 'chats',
        active: filter.kind === 'chats',
        label: t('settings.memory.nav.chats'),
        count: counts.chats,
        onClick: () => onFilterChange({ kind: 'chats' }),
      })}
      {visibleProjects.map((p) =>
        row({
          id: `project:${p.id}`,
          active: filter.kind === 'project' && filter.projectId === p.id,
          label: p.name,
          onClick: () => onFilterChange({ kind: 'project', projectId: p.id }),
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
        onClick: () => onFilterChange({ kind: 'people' }),
      })}
      {visibleSubjects.map((s) =>
        row({
          id: `person:${s.scope_id}`,
          active: filter.kind === 'person' && filter.scopeId === s.scope_id,
          label: s.display_name ?? s.scope_id,
          onClick: () => onFilterChange({ kind: 'person', scopeId: s.scope_id }),
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
          {selectedPerson.opted_out !== 0 && (
            <div className="text-xs text-warning-soft-foreground">{t('settings.memory.person.optedOut')}</div>
          )}

          <Button
            variant="ghost"
            className="w-full justify-start font-normal"
            onClick={async () => {
              await api.setMemorySubjectFlags(selectedPerson.scope_id, selectedPerson.is_pinned === 0, undefined)
              onChanged()
            }}
            data-slot="memory-pin-toggle"
          >
            <Pin className={selectedPerson.is_pinned !== 0 ? 'text-foreground' : 'text-muted'} />
            {selectedPerson.is_pinned !== 0 ? t('settings.memory.unpin') : t('settings.memory.pin')}
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
