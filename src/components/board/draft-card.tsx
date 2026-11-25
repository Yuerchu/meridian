// A card being written: which project its worktree comes from, and what it is
// for. Appended at the end of the column, so every card already there stays
// where it was. Enter puts it on the board, Escape in an empty box takes it
// back.
import './draft-card.css'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { Select } from '@/components/yuerchu-ui/components/select/select'
import { useBoardStore } from '@/stores/board-store'
import { useConversationStore } from '@/stores/conversation-store'
import type { BoardStage } from '@/types'
import { ComposerField } from './card-composer'

const PROJECT_KEY = 'meridian.board.projectId'

/** A draft's project: what this card already chose, then the last successful
 *  create, then the first local project. A stored id that is no longer in
 *  the list is skipped rather than kept as a selection nothing can submit. */
export function resolveDraftProjectId(
  stored: string | null,
  remembered: string | null,
  projectIds: readonly string[],
): string | null {
  if (stored !== null && projectIds.includes(stored)) return stored
  if (remembered !== null && projectIds.includes(remembered)) return remembered
  return projectIds[0] ?? null
}

export function DraftCard({
  stage,
  onDone,
  onError,
}: {
  stage: BoardStage
  onDone: () => void
  onError: (error: string) => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLElement>(null)
  const draftId = `draft:${stage}`
  const value = useBoardStore((s) => s.composerText[draftId] ?? '')
  const setComposerText = useBoardStore((s) => s.setComposerText)
  const storedProject = useBoardStore((s) => s.draftProjectId[draftId] ?? null)
  const setDraftProjectId = useBoardStore((s) => s.setDraftProjectId)
  // A worktree is made from a folder, so only a project with one can hold a card.
  const projects = useConversationStore((s) => s.projects).filter((p) => p.source_type === 'local' && p.path !== null)
  const remembered = typeof localStorage === 'undefined' ? null : localStorage.getItem(PROJECT_KEY)
  const projectId = resolveDraftProjectId(
    storedProject,
    remembered,
    projects.map((p) => p.id),
  )

  // The press that opened the draft was the request to type.
  useEffect(() => {
    ref.current?.querySelector('textarea')?.focus()
  }, [])

  const create = async () => {
    const text = value.trim()
    if (!text || projectId === null) return
    const title = text.split('\n')[0]
    try {
      await api.boardTaskCreate({ projectId, title, request: text, stage })
      if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_KEY, projectId)
      setComposerText(draftId, '')
      setDraftProjectId(draftId, null)
      await useBoardStore.getState().load()
      onDone()
    } catch (err) {
      onError(t('board.error.create', { error: String(err) }))
    }
  }

  return (
    <article ref={ref} role="listitem" data-slot="board-card" data-draft="" className="m-board-draft">
      <span className="m-board-draft__header">
        <span className="m-board-draft__title">{t('board.draft.title')}</span>
        <Badge size="sm" tone="accent">
          {t(`board.columns.${stage}`)}
        </Badge>
      </span>
      {projects.length === 0 ? (
        <span className="m-board-draft__empty">{t('board.draft.noProject')}</span>
      ) : (
        <>
          <Select
            size="sm"
            aria-label={t('board.draft.project')}
            selectedKey={projectId}
            onSelectionChange={(key) => {
              if (typeof key === 'string') setDraftProjectId(draftId, key)
            }}
          >
            {projects.map((p) => (
              <ListBoxItem key={p.id} id={p.id} textValue={p.name}>
                {p.name}
              </ListBoxItem>
            ))}
          </Select>
          <ComposerField
            value={value}
            setValue={(next) => setComposerText(draftId, next)}
            ariaLabel={t('board.draft.title')}
            placeholder={t('board.draft.placeholder')}
            running={false}
            maxLines={6}
            onSend={() => void create()}
            onEscapeEmpty={onDone}
          />
        </>
      )}
    </article>
  )
}
