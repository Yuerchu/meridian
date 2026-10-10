// The agent board: every task a card, every started card one conversation in
// one worktree. Three decisions shape the page.
// - A column is a stage a person chose; what the agent is doing is a mark on
//   the card. A card that starts asking does not change places — the strip is
//   what is sorted, oldest question first.
// - Everything is answered in place: a card opens where it stands, several at
//   once, and nothing on the page becomes inert while one is.
// - Focus: only the open columns are full width; the others fold to rails
//   that peek on hover without moving anything, and open on a press.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Plus } from '@keyline-icons/react/two-tone'

import { Button, Chip, Kanban } from '@/components/base'
import { useHotkey } from '@/hooks/use-hotkey'
import { useBoardStore } from '@/stores/board-store'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import type { BoardStage, BoardTaskInfoResponse } from '@/types'
import { AgentCard } from './agent-card'
import { agentStateOf, askedAtOf, needsPerson, type AgentState } from './agent-state'
import { DraftCard } from './draft-card'
import { FoldedColumn } from './folded-column'
import { Masonry } from './masonry'

const STAGES: BoardStage[] = ['backlog', 'running', 'review', 'done']

/** In px: below this a lane is not opened (a card's composer needs the room). */
const MIN_LANE_WIDTH = 304

interface Card {
  task: BoardTaskInfoResponse
  state: AgentState
}

export function BoardPage({ onOpenConversation }: { onOpenConversation: (conversationId: string) => void }) {
  const { t } = useTranslation()
  const tasks = useBoardStore((s) => s.tasks)
  const loadError = useBoardStore((s) => s.error)
  const openColumns = useBoardStore((s) => s.openColumns)
  const setColumnOpen = useBoardStore((s) => s.setColumnOpen)
  const setOpenColumns = useBoardStore((s) => s.setOpenColumns)
  const expanded = useBoardStore((s) => s.expanded)
  const setExpanded = useBoardStore((s) => s.setExpanded)
  const focused = useBoardStore((s) => s.focused)
  const setFocused = useBoardStore((s) => s.setFocused)
  const sessions = useConversationStore((s) => s.sessions)
  const attention = useConversationStore((s) => s.attention)
  const [draft, setDraft] = useState<BoardStage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void useBoardStore.getState().load()
  }, [])

  const cards: Card[] = useMemo(() => {
    const byConversation = new Map<string, AttentionItem[]>()
    for (const item of Object.values(attention)) {
      const list = byConversation.get(item.conversationId) ?? []
      list.push(item)
      byConversation.set(item.conversationId, list)
    }
    return tasks.map((task) => ({
      task,
      state: agentStateOf(
        t,
        task,
        task.conversation_id === null ? undefined : sessions[task.conversation_id],
        task.conversation_id === null ? [] : (byConversation.get(task.conversation_id) ?? []),
      ),
    }))
  }, [tasks, sessions, attention, t])

  const waiting = useMemo(
    () => cards.filter((c) => needsPerson(c.state)).sort((a, b) => askedAtOf(a.state) - askedAtOf(b.state)),
    [cards],
  )

  const reveal = (card: Card) => {
    setColumnOpen(card.task.stage, true)
    setExpanded(card.task.id, true)
    setFocused(card.task.id)
    requestAnimationFrame(() => {
      boardRef.current
        ?.querySelector(`[data-card-id="${card.task.id}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    })
  }

  // PageDown / PageUp walk the strip, oldest first. Bound only while something
  // waits, so with nothing to walk they scroll as usual; inside a text field
  // they are the field's (`useHotkey`'s default).
  const step = (delta: number) => {
    const at = waiting.findIndex((c) => c.task.id === focused)
    reveal(waiting[(at + delta + waiting.length) % waiting.length])
  }
  useHotkey('pagedown', () => step(1), { enabled: waiting.length > 0 })
  useHotkey('pageup', () => step(-1), { enabled: waiting.length > 0 })

  const allOpen = openColumns.length === STAGES.length
  const firstOpen = STAGES.findIndex((s) => openColumns.includes(s))

  return (
    <div data-slot="board-page" className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
      <header className="flex items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-title-3-semibold text-text-primary">{t('board.title')}</h1>
          <p className="text-caption-1-regular text-text-secondary">{t('board.hint')}</p>
        </div>
        <Button
          className="ml-auto"
          size="small"
          variant="secondary"
          onPress={() => setOpenColumns(allOpen ? ['running'] : STAGES)}
        >
          {allOpen ? t('board.onlyRunning') : t('board.openAll')}
        </Button>
      </header>

      {(error ?? loadError) && (
        <p
          role="alert"
          className="rounded-xl bg-status-danger-soft px-3 py-2 text-caption-1-regular text-status-danger-soft-foreground"
        >
          {error ?? t('board.error.load', { error: loadError })}
        </p>
      )}

      <section
        aria-label={t('board.strip.label')}
        className="flex items-center gap-2 overflow-x-auto rounded-2xl bg-background-primary-default p-2 shadow-xs"
      >
        <span className="shrink-0 px-1 text-caption-1-medium text-text-secondary">
          {t('board.strip.count', { count: waiting.length })}
        </span>
        {waiting.length === 0 && (
          <span className="text-caption-1-regular text-text-secondary">{t('board.strip.empty')}</span>
        )}
        {waiting.map((card) => (
          <Button key={card.task.id} size="small" variant="secondary" className="shrink-0" onPress={() => reveal(card)}>
            <span className="flex items-center gap-1.5">
              <span className="max-w-48 truncate">{card.task.title}</span>
              <span className="text-text-secondary">{t(`board.state.${card.state.kind}`)}</span>
            </span>
          </Button>
        ))}
      </section>

      <div ref={boardRef} className="min-h-0 flex-1">
        <Kanban aria-label={t('board.title')} className="h-full min-h-96 items-stretch pb-2">
          {STAGES.map((stage, index) => {
            const title = t(`board.columns.${stage}`)
            const column = cards.filter((c) => c.task.stage === stage)
            const pending = column.filter((c) => needsPerson(c.state)).length
            if (!openColumns.includes(stage)) {
              return (
                <FoldedColumn
                  key={stage}
                  title={title}
                  cards={column.map((c) => ({ ...c, waiting: needsPerson(c.state) }))}
                  side={index < firstOpen ? 'start' : 'end'}
                  onOpen={() => setColumnOpen(stage, true)}
                />
              )
            }
            const items: (Card | 'draft')[] = draft === stage ? [...column, 'draft'] : column
            return (
              <Kanban.Column key={stage} className="min-w-72 flex-1">
                <Kanban.ColumnHeader>
                  <Button
                    size="xs"
                    variant="neutral"
                    iconOnly
                    leadingIcon={ChevronLeft}
                    aria-label={t('board.column.fold', { title })}
                    onPress={() => setColumnOpen(stage, false)}
                  />
                  <Kanban.ColumnTitle>{title}</Kanban.ColumnTitle>
                  {pending > 0 && (
                    <Chip size="sm" variant="soft" color="warning">
                      {t('board.column.waiting', { count: pending })}
                    </Chip>
                  )}
                  <Kanban.ColumnCount>{column.length}</Kanban.ColumnCount>
                  {stage === 'backlog' && (
                    <Button
                      size="xs"
                      variant="neutral"
                      iconOnly
                      leadingIcon={Plus}
                      aria-label={t('board.column.add', { title })}
                      onPress={() => setDraft(stage)}
                    />
                  )}
                </Kanban.ColumnHeader>
                <Kanban.ColumnBody>
                  <Masonry
                    items={items}
                    minLaneWidth={MIN_LANE_WIDTH}
                    label={title}
                    empty={t('board.column.empty')}
                    render={(item) =>
                      item === 'draft' ? (
                        <DraftCard key="draft" stage={stage} onDone={() => setDraft(null)} onError={setError} />
                      ) : (
                        <AgentCard
                          key={item.task.id}
                          task={item.task}
                          state={item.state}
                          expanded={expanded.includes(item.task.id)}
                          focused={focused === item.task.id}
                          onToggle={() => {
                            setFocused(null)
                            setExpanded(item.task.id, !expanded.includes(item.task.id))
                          }}
                          onOpenConversation={onOpenConversation}
                          onError={setError}
                        />
                      )
                    }
                  />
                </Kanban.ColumnBody>
              </Kanban.Column>
            )
          })}
        </Kanban>
      </div>
    </div>
  )
}
