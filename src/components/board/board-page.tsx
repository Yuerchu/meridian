// The agent board: every task a card, every started card one conversation in
// one worktree. Three decisions shape the page.
// - A column is a stage a person chose; what the agent is doing is a mark on
//   the card. A card that starts asking does not change places — the strip is
//   what is sorted, oldest question first.
// - Everything is answered in place: a card opens where it stands, several at
//   once, and nothing on the page becomes inert while one is.
// - Focus: only the open columns are full width; the others fold to rails
//   that peek on hover without moving anything, and open on a press.
import './board-page.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Plus } from '@keyline-icons/react/two-tone'

import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { useConfirm } from '@/hooks/use-confirm'
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
  const { confirm, confirmDialog } = useConfirm()

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
    <div data-slot="board-page" className="m-board-page">
      <header className="m-board-page__header">
        <div className="m-board-page__heading">
          <h1 className="m-board-page__title">{t('board.title')}</h1>
          <p className="m-board-page__hint">{t('board.hint')}</p>
        </div>
        <div className="m-board-page__toggle">
          <Button size="sm" variant="secondary" onPress={() => setOpenColumns(allOpen ? ['running'] : STAGES)}>
            {allOpen ? t('board.onlyRunning') : t('board.openAll')}
          </Button>
        </div>
      </header>

      {(error ?? loadError) && (
        <p role="alert" className="m-board-page__error">
          {error ?? t('board.error.load', { error: loadError })}
        </p>
      )}

      <section aria-label={t('board.strip.label')} className="m-board-page__strip">
        <span className="m-board-page__strip-count">{t('board.strip.count', { count: waiting.length })}</span>
        {waiting.length === 0 && <span className="m-board-page__strip-empty">{t('board.strip.empty')}</span>}
        {waiting.map((card) => (
          <span key={card.task.id} className="m-board-page__strip-item">
            <Button size="sm" variant="secondary" onPress={() => reveal(card)}>
              <span className="m-board-page__strip-label">
                <span className="m-board-page__strip-title">{card.task.title}</span>
                <span className="m-board-page__strip-state">{t(`board.state.${card.state.kind}`)}</span>
              </span>
            </Button>
          </span>
        ))}
      </section>

      <div ref={boardRef} className="m-board-page__board">
        <div role="region" aria-label={t('board.title')} data-slot="board-columns" className="m-board-columns">
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
              <section
                key={stage}
                data-slot="board-column"
                data-stage={stage}
                aria-label={title}
                className="m-board-column"
              >
                <div className="m-board-column__header">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ChevronLeft />}
                    aria-label={t('board.column.fold', { title })}
                    onPress={() => setColumnOpen(stage, false)}
                  />
                  <h2 className="m-board-column__title">{title}</h2>
                  {pending > 0 && (
                    <Badge size="sm" tone="warning">
                      {t('board.column.waiting', { count: pending })}
                    </Badge>
                  )}
                  <span className="m-board-column__count">{column.length}</span>
                  {stage === 'backlog' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Plus />}
                      aria-label={t('board.column.add', { title })}
                      onPress={() => setDraft(stage)}
                    />
                  )}
                </div>
                <div className="m-board-column__body">
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
                          confirm={confirm}
                        />
                      )
                    }
                  />
                </div>
              </section>
            )
          })}
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
