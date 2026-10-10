// A card being written: which project its worktree comes from, and what it is
// for. Appended at the end of the column, so every card already there stays
// where it was. Enter puts it on the board, Escape in an empty box takes it
// back.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import { Chip, Kanban, PromptInput, Select, SelectItem } from '@/components/base'
import { useBoardStore } from '@/stores/board-store'
import { useConversationStore } from '@/stores/conversation-store'
import type { BoardStage } from '@/types'

const PROJECT_KEY = 'meridian.board.projectId'

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
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState('')
  // A worktree is made from a folder, so only a project with one can hold a card.
  const projects = useConversationStore((s) => s.projects).filter((p) => p.source_type === 'local' && p.path !== null)
  const remembered = typeof localStorage === 'undefined' ? null : localStorage.getItem(PROJECT_KEY)
  const [projectId, setProjectId] = useState<string | null>(
    projects.find((p) => p.id === remembered)?.id ?? projects[0]?.id ?? null,
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
      await useBoardStore.getState().load()
      onDone()
    } catch (err) {
      onError(t('board.error.create', { error: String(err) }))
    }
  }

  return (
    <Kanban.Card
      ref={ref}
      id="draft"
      textValue={t('board.draft.title')}
      data-draft
      className="flex flex-col gap-2 border-dashed border-border-button-active p-2.5"
    >
      <span className="flex items-center gap-1.5">
        <span className="text-body-2-medium text-text-primary">{t('board.draft.title')}</span>
        <Chip size="sm" variant="soft" color="accent">
          {t(`board.columns.${stage}`)}
        </Chip>
      </span>
      {projects.length === 0 ? (
        <span className="text-caption-1-regular text-text-secondary">{t('board.draft.noProject')}</span>
      ) : (
        <>
          <Select
            aria-label={t('board.draft.project')}
            selectedKey={projectId ?? undefined}
            onSelectionChange={(key) => setProjectId(String(key))}
          >
            {projects.map((p) => (
              <SelectItem key={p.id} id={p.id} textValue={p.name}>
                {p.name}
              </SelectItem>
            ))}
          </Select>
          <PromptInput value={value} onValueChange={setValue} onSubmit={() => void create()} maxLines={6}>
            <PromptInput.Shell className="flex items-end gap-1 rounded-2xl pr-1">
              <div className="min-w-0 flex-1">
                <PromptInput.TextArea
                  aria-label={t('board.draft.title')}
                  placeholder={t('board.draft.placeholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && value === '') onDone()
                  }}
                />
              </div>
              <PromptInput.Send
                sendLabel={t('board.composer.send')}
                stopLabel={t('board.composer.stop')}
                className="mb-1"
              />
            </PromptInput.Shell>
          </PromptInput>
        </>
      )}
    </Kanban.Card>
  )
}
