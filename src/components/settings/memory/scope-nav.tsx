import type * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bookmark, UserX } from '@keyline-icons/react/two-tone'
import { api } from '@/api'
import { Button, Card } from '@/components/base'
import { useConfirm } from '@/hooks/use-confirm'
import { SettingsInlineAction, SettingsNavRow } from '../primitives'
import { subjectLabel } from './labels'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { cx } from '@/utils/cx'
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
   * The registry settings modal's rail row (`SettingsNavRow`): the current
   * row on `background-secondary-hover`, `aria-current` saying so to
   * everyone else. It used to be a `Button` swapping `secondary` for the
   * current row and `ghost` for the rest, which on BoardUI's accent-soft
   * `ghost` drew every row *but* the current one as selected.
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
    label: React.ReactNode
    count?: number | null
    onPress: () => void
    indent?: boolean
  }) => (
    <SettingsNavRow
      key={id}
      isActive={active}
      label={label}
      value={count === null ? undefined : String(count)}
      trailing={null}
      className={cx(indent && 'pl-6')}
      onPress={onPress}
      data-slot="memory-scope-row"
    />
  )

  /**
   * The branches used to stop at eight with nothing after them — a ninth
   * project's memories were in the database and unreachable from here.
   *
   * A quiet text action lined up with the indented rows (settings-tools.tsx's
   * `InlineAction`), not a full-width grey button: it offers more of the list
   * and should not outweigh the rows it is offering.
   */
  const moreRow = (slot: string, expanded: boolean, total: number, onToggle: () => void) => (
    <SettingsInlineAction key={`${slot}-more`} className="my-1 ml-6" onPress={onToggle} data-slot={slot}>
      {expanded ? t('settings.memory.nav.showLess') : t('settings.memory.nav.showAll', { count: total })}
    </SettingsInlineAction>
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
      <div data-slot="memory-scope-nav-title" className="px-2 pb-1 text-caption-1-medium text-text-secondary">
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
          label: <SubjectName subject={s} />,
          onPress: () => onFilterChange({ kind: 'person', scopeId: s.scope_id }),
          indent: true,
        }),
      )}
      {subjects.length > COLLAPSED_BRANCH &&
        moreRow('memory-scope-more-people', allSubjects, subjects.length, () => setAllSubjects((v) => !v))}

      {selectedPerson && (
        <Card data-slot="memory-person-card" className="mt-3">
          <Card.Header>
            <Card.Title>
              <SubjectName subject={selectedPerson} />
            </Card.Title>
            <Card.Description>
              {t('settings.memory.person.lastSeen', {
                when: relativeTime(selectedPerson.last_seen_at),
              })}
            </Card.Description>
          </Card.Header>
          {selectedPerson.opted_out && (
            <div
              data-slot="memory-person-opted-out"
              className="text-caption-1-regular text-status-warning-soft-foreground"
            >
              {t('settings.memory.person.optedOut')}
            </div>
          )}

          <Button
            leadingIcon={Bookmark}
            variant="secondary"
            className="w-full justify-start text-body-regular"
            onPress={async () => {
              await api.setMemorySubjectFlags({
                subjectScopeId: selectedPerson.scope_id,
                isPinned: !selectedPerson.is_pinned,
                optedOut: null,
              })
              onChanged()
            }}
            data-slot="memory-pin-toggle"
          >
            {selectedPerson.is_pinned ? t('settings.memory.unpin') : t('settings.memory.pin')}
          </Button>

          <Button
            leadingIcon={UserX}
            variant="danger"
            className="w-full justify-start text-body-regular"
            onPress={async () => {
              const ok = await confirm({
                title: t('settings.memory.person.forgetConfirmTitle'),
                body: t('settings.memory.person.forgetConfirmBody'),
              })
              if (!ok) return
              await api.forgetMemorySubject(selectedPerson.scope_id)
              onChanged()
            }}
          >
            {t('settings.memory.person.forget')}
          </Button>
        </Card>
      )}
      {confirmDialog}
    </div>
  )
}

/**
 * A person's display name, or — with none recorded — what kind of id they are
 * with the number itself set as a quieter identifier.
 */
function SubjectName({ subject }: { subject: MemorySubjectInfoResponse }) {
  const { t } = useTranslation()
  const label = subjectLabel(t, subject)
  if (!label.id) return <>{label.name}</>
  return (
    <>
      {label.name}{' '}
      <span data-slot="memory-subject-id" className="font-mono text-caption-1-regular text-text-secondary">
        {label.id}
      </span>
    </>
  )
}
