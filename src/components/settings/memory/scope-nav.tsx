import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin, PersonXmark } from '@gravity-ui/icons'
import { api } from '@/api'
import { AlertDialog, Button, Card } from '@heroui/react'
import { cn } from '@/lib/utils'
import type { MemorySubject, Project } from '@/types'
import type { ScopeFilter } from './use-memory-browser'

function relativeTime(ms: number): string {
  const delta = Date.now() - ms
  const hours = Math.floor(delta / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

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
export function ScopeNav({
  filter,
  onFilterChange,
  counts,
  projects,
  subjects,
  onChanged,
}: ScopeNavProps) {
  const { t } = useTranslation()
  const [confirmForget, setConfirmForget] = useState(false)
  // `AlertDialog.Body` is a plain div — only a `Heading slot="title"` is wired
  // up for us, so without this the dialog announces its title and nothing else.
  const forgetDescId = useId()

  const selectedPerson =
    filter.kind === 'person' ? subjects.find((s) => s.scope_id === filter.scopeId) : undefined

  const row = (active: boolean, label: string, count: number | null, onClick: () => void, indent = false) => (
    <Button
      key={label}
      variant={active ? 'secondary' : 'ghost'}
      className={cn('w-full justify-between font-normal', indent && 'pl-6')}
      onClick={onClick}
      data-slot="memory-scope-row"
    >
      <span className="truncate">{label}</span>
      {count !== null && <span className="text-xs text-muted">{count}</span>}
    </Button>
  )

  return (
    <div data-slot="memory-scope-nav" className="flex w-56 shrink-0 flex-col gap-0.5">
      <div className="px-2 pb-1 text-xs font-medium text-muted">
        {t('settings.memory.nav.scope')}
      </div>

      {row(filter.kind === 'all', t('settings.memory.nav.all'), counts.all, () =>
        onFilterChange({ kind: 'all' }),
      )}
      {row(
        filter.kind === 'clientGlobal',
        t('settings.memory.nav.clientGlobal'),
        counts.clientGlobal,
        () => onFilterChange({ kind: 'clientGlobal' }),
      )}
      {row(filter.kind === 'global', t('settings.memory.nav.global'), counts.global, () =>
        onFilterChange({ kind: 'global' }),
      )}
      {row(filter.kind === 'chats', t('settings.memory.nav.chats'), counts.chats, () =>
        onFilterChange({ kind: 'chats' }),
      )}
      {projects.slice(0, 8).map((p) =>
        row(
          filter.kind === 'project' && filter.projectId === p.id,
          p.name,
          null,
          () => onFilterChange({ kind: 'project', projectId: p.id }),
          true,
        ),
      )}
      {row(filter.kind === 'people', t('settings.memory.nav.people'), counts.people, () =>
        onFilterChange({ kind: 'people' }),
      )}
      {subjects.slice(0, 8).map((s) =>
        row(
          filter.kind === 'person' && filter.scopeId === s.scope_id,
          s.display_name ?? s.scope_id,
          null,
          () => onFilterChange({ kind: 'person', scopeId: s.scope_id }),
          true,
        ),
      )}

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
              await api.setMemorySubjectFlags(
                selectedPerson.scope_id,
                selectedPerson.is_pinned === 0,
                undefined,
              )
              onChanged()
            }}
            data-slot="memory-pin-toggle"
          >
            <Pin className={selectedPerson.is_pinned !== 0 ? 'text-foreground' : 'text-muted'} />
            {selectedPerson.is_pinned !== 0
              ? t('settings.memory.unpin')
              : t('settings.memory.pin')}
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start font-normal"
            onClick={() => setConfirmForget(true)}
          >
            <PersonXmark className="text-danger" />
            {t('settings.memory.person.forget')}
          </Button>
          <AlertDialog.Backdrop isOpen={confirmForget} onOpenChange={setConfirmForget}>
            <AlertDialog.Container>
              <AlertDialog.Dialog aria-describedby={forgetDescId}>
                <AlertDialog.Header>
                  <AlertDialog.Heading>
                    {t('settings.memory.person.forgetConfirmTitle')}
                  </AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body id={forgetDescId}>
                  {t('settings.memory.person.forgetConfirmBody')}
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button slot="close" variant="tertiary">
                    {t('common.cancel')}
                  </Button>
                  <Button
                    slot="close"
                    variant="danger"
                    onClick={async () => {
                      await api.forgetMemorySubject(selectedPerson.scope_id)
                      onChanged()
                    }}
                  >
                    {t('common.confirm')}
                  </Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </Card>
      )}
    </div>
  )
}
