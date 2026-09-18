import { useTranslation } from 'react-i18next'

import { Check, CircleQuestion, Clock, TriangleExclamation } from '@gravity-ui/icons'
import { Button, Spinner } from '@/components/base'
import { PromptInput } from '@/components/base'

import { isCoarsePointer } from '@/hooks/use-coarse-pointer'
import { queueState } from '@/hooks/use-prompt-queue'
import type { QueueDelivery, QueuedPromptInfoResponse } from '@/types'
import { TodoBarView } from './todo-bar'
import type { TodoArgs } from './todo-list'

interface PromptQueueProps {
  items: QueuedPromptInfoResponse[]
  /** Checklist the turn is currently working through, if any. */
  currentTodos?: TodoArgs | null
  /** The turn is still running, so a generic current row is worth drawing when
   *  there is no checklist to hang the queue off. */
  streaming?: boolean
  /** The whole queue is stopped, waiting for a person. */
  held: boolean
  onRemove: (id: string) => void
  onReorder: (next: QueuedPromptInfoResponse[]) => void
  onSetDelivery: (id: string, delivery: QueueDelivery) => void
  onRelease: () => void
}

/**
 * Pro's own mark for a steered row. The Steer button's default children are
 * this plus the English word "Steer"; overriding the children without it
 * loses the only thing that tells an interjection from a follow-up at a
 * glance, which is why both the icon and the action rebuild it.
 */
function SteerMark() {
  return (
    <span aria-hidden className="text-text-secondary text-xs" data-slot="queue-steer-mark">
      ↳
    </span>
  )
}

/**
 * The messages stacked up above the composer, in the order they will be sent.
 *
 * HeroUI's Queue is one card with the *current* run at the top and the stacked
 * messages under it. The two delivery modes are not urgency levels, and they
 * are not the same shape either:
 *
 * - **`interject`** hangs off the current row with Pro's `↳`, because it goes
 *   in at the next gap of the turn already running.
 * - **`follow_up`** is an ordinary queued row, and its one action is Steer —
 *   Pro's own word for switching it to an interjection, which also delivers it.
 *
 * Drawing them as a flat list next to a separate TodoBar made both modes look
 * like the nested one: the checklist sat where "current" belongs, and every
 * queued path appeared to hang off it.
 *
 * A row whose delivery is in doubt, and a held queue, are still drawn
 * differently: the first is a barrier that cannot be resent, the second is a
 * decision to start again.
 */
export function PromptQueue({
  items,
  currentTodos = null,
  streaming = false,
  held,
  onRemove,
  onReorder,
  onSetDelivery,
  onRelease,
}: PromptQueueProps) {
  const { t } = useTranslation()
  if (items.length === 0) return null

  const current = currentTodos ? (
    <div data-slot="queue-current" className="border-b border-separator-border">
      <TodoBarView todos={currentTodos} framed={false} />
    </div>
  ) : streaming ? (
    <div
      data-slot="queue-current"
      className="flex items-center gap-2 border-b border-separator-border px-3 py-2 text-xs text-text-secondary"
    >
      <Spinner size="sm" className="shrink-0" />
      <span data-slot="queue-running-label">{t('chat.queue.running')}</span>
    </div>
  ) : null

  const movable = (item: QueuedPromptInfoResponse) => {
    const state = queueState(item)
    return state !== 'in_doubt' && state !== 'settled' && state !== 'held'
  }

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= items.length || !movable(items[index]) || !movable(items[target])) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onReorder(next)
  }

  return (
    <PromptInput.Queue actionsVisibility={isCoarsePointer() ? 'always' : 'hover'}>
      {held && (
        <div
          data-slot="queue-held"
          className="flex items-center gap-2 px-3 py-2 text-xs text-status-warning"
          role="status"
        >
          <TriangleExclamation className="size-4 shrink-0" />
          <span data-slot="queue-held-label" className="min-w-0 flex-1">
            {t('chat.queue.held')}
          </span>
          {/* The only way to restart a held queue; the expanded hit area is
              what makes it reachable with a finger. */}
          <Button size="small" variant="ghost" className="touch-hitbox px-2 text-xs" onPress={onRelease}>
            {t('chat.queue.release')}
          </Button>
        </div>
      )}
      {current}
      <PromptInput.Queue.List values={items} onReorder={onReorder}>
        {items.map((item, index) => {
          const state = queueState(item)
          const doubtful = state === 'in_doubt'
          // Taken by the agent, and still here because the transcript row it
          // becomes is owed to the running turn's next round boundary. Nothing
          // can be done to it any more; it is on screen so that the message is
          // *somewhere* until it appears in the conversation.
          const taken = state === 'settled'
          const settled = doubtful || taken
          // Nothing the user may move. A held row is the third: it is a barrier
          // like a doubtful one, `reorder` refuses to move it, and everything
          // else is placed *after* it — so a handle there offers a drag whose
          // only outcome is the row springing back.
          const pinned = settled || state === 'held'
          const interject = item.delivery === 'interject'
          return (
            <PromptInput.Queue.Item key={item.id} value={item}>
              {/* No handle on a row that must not move. A settled row's
                  position means nothing, and a doubtful one is the barrier
                  that stops everything behind it from running on a premise
                  nobody has confirmed — dragging past it is stepping around
                  the very thing it is for. The backend refuses either way
                  (`db::ops::queue::reorder`); this is so the affordance does
                  not offer something that will not happen. */}
              {!pinned && <PromptInput.Queue.Item.Handle aria-label={t('chat.queue.reorder')} />}
              <PromptInput.Queue.Item.Body data-delivery={item.delivery}>
                {/* For a doubtful row the icon is the doubt rather than the
                    mode: what happens to it next is the only thing about it
                    still undecided, and the mode no longer decides anything.
                    An interjection uses Pro's ↳, not a different arrow — that
                    mark is what Steer itself draws, so a row that will
                    interrupt and the button that makes one look the same. */}
                <PromptInput.Queue.Item.Icon>
                  {doubtful ? (
                    <CircleQuestion className="size-3.5 text-status-warning" />
                  ) : taken ? (
                    <Check className="size-3.5 text-text-secondary" />
                  ) : interject ? (
                    <SteerMark />
                  ) : (
                    <Clock className="size-3.5" />
                  )}
                </PromptInput.Queue.Item.Icon>
                <PromptInput.Queue.Item.Content>{item.content}</PromptInput.Queue.Item.Content>
                {doubtful && (
                  <PromptInput.Queue.Item.Description className="text-status-warning">
                    {t('chat.queue.inDoubt')}
                  </PromptInput.Queue.Item.Description>
                )}
                {taken && (
                  <PromptInput.Queue.Item.Description>{t('chat.queue.taken')}</PromptInput.Queue.Item.Description>
                )}
              </PromptInput.Queue.Item.Body>
              {/* Neither of the settled states gets any. A doubtful row cannot
                  be removed — the record that the agent may be acting on it is
                  the only reason anyone would ever find out — and it cannot be
                  re-sent, which is the whole design. A taken one is simply no
                  longer the queue's. */}
              {!settled && (
                <PromptInput.Queue.Item.Actions>
                  {!pinned && (
                    <>
                      <PromptInput.Queue.Item.Action
                        isDisabled={index === 0 || !movable(items[index - 1])}
                        onPress={() => move(index, -1)}
                      >
                        {t('chat.queue.moveUp')}
                      </PromptInput.Queue.Item.Action>
                      <PromptInput.Queue.Item.Action
                        isDisabled={index === items.length - 1 || !movable(items[index + 1])}
                        onPress={() => move(index, 1)}
                      >
                        {t('chat.queue.moveDown')}
                      </PromptInput.Queue.Item.Action>
                    </>
                  )}
                  {/* Pro's own word for it, and it does what it says: switching
                      a row to `interject` also delivers it, so this is "now"
                      rather than a setting that takes effect eventually. Its
                      opposite is a plain action rather than a menu — with two
                      modes, a menu is a click to reach a single item. The ↳ is
                      not optional: passing only the label replaces the default
                      children, which is how the mark disappeared. */}
                  {interject ? (
                    <PromptInput.Queue.Item.Action onPress={() => onSetDelivery(item.id, 'follow_up')}>
                      {t('chat.queue.followUp')}
                    </PromptInput.Queue.Item.Action>
                  ) : (
                    <PromptInput.Queue.Item.Steer onPress={() => onSetDelivery(item.id, 'interject')}>
                      <SteerMark />
                      {t('chat.queue.interject')}
                    </PromptInput.Queue.Item.Steer>
                  )}
                  <PromptInput.Queue.Item.Remove
                    aria-label={t('chat.queue.remove')}
                    onPress={() => onRemove(item.id)}
                  />
                </PromptInput.Queue.Item.Actions>
              )}
            </PromptInput.Queue.Item>
          )
        })}
      </PromptInput.Queue.List>
    </PromptInput.Queue>
  )
}
