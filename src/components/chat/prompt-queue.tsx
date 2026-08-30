import { useTranslation } from 'react-i18next'

import { ArrowRightFromSquare, Check, CircleQuestion, Clock, TriangleExclamation } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { PromptInput } from '@heroui-pro/react/prompt-input'

import { queueState } from '@/hooks/use-prompt-queue'
import type { QueueDelivery, QueuedPrompt } from '@/types'

interface PromptQueueProps {
  items: QueuedPrompt[]
  /** The whole queue is stopped, waiting for a person. */
  held: boolean
  onRemove: (id: string) => void
  onReorder: (next: QueuedPrompt[]) => void
  onSetDelivery: (id: string, delivery: QueueDelivery) => void
  onRelease: () => void
}

/**
 * The messages stacked up above the composer, in the order they will be sent.
 *
 * Three things this draws that a plain list would not, each because the queue
 * can be in a state a person has to be able to tell apart at a glance:
 *
 * - **Which mode a row is in.** The two are not urgency levels — one waits for
 *   the turn to end, the other goes in mid-flight — so a row that will
 *   interrupt has to look different from one that will not, before it does.
 *   The icon carries it, and the one action on the row is the way to change it.
 * - **A row whose delivery is in doubt.** It was handed over and never
 *   acknowledged, it will never be sent again, and it stops everything behind
 *   it. Drawn as the ordinary "waiting" the queue would look stalled for no
 *   reason — so it says so on the row itself, in the description rather than
 *   among the actions, which Pro only reveals on hover.
 * - **A held queue.** The turn in front of it did not finish, so nothing behind
 *   it is safe to assume — and starting again is a decision, which is why it is
 *   a button and not a timer.
 */
export function PromptQueue({ items, held, onRemove, onReorder, onSetDelivery, onRelease }: PromptQueueProps) {
  const { t } = useTranslation()
  if (items.length === 0) return null

  const movable = (item: QueuedPrompt) => {
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
    <PromptInput.Queue>
      {held && (
        <div data-slot="queue-held" className="flex items-center gap-2 px-3 py-2 text-xs text-warning" role="status">
          <TriangleExclamation className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t('chat.queue.held')}</span>
          {/* The only way to restart a held queue, and about 20px tall without
              the expanded hit area. */}
          <Button size="sm" variant="ghost" className="touch-hitbox h-auto px-2 py-0.5 text-xs" onPress={onRelease}>
            {t('chat.queue.release')}
          </Button>
        </div>
      )}
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
              <PromptInput.Queue.Item.Body>
                {/* For a doubtful row the icon is the doubt rather than the
                    mode: what happens to it next is the only thing about it
                    still undecided, and the mode no longer decides anything. */}
                <PromptInput.Queue.Item.Icon>
                  {doubtful ? (
                    <CircleQuestion className="size-3.5 text-warning" />
                  ) : taken ? (
                    <Check className="size-3.5 text-muted" />
                  ) : interject ? (
                    <ArrowRightFromSquare className="size-3.5" />
                  ) : (
                    <Clock className="size-3.5" />
                  )}
                </PromptInput.Queue.Item.Icon>
                <PromptInput.Queue.Item.Content>{item.content}</PromptInput.Queue.Item.Content>
                {doubtful && (
                  <PromptInput.Queue.Item.Description className="text-warning">
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
                      modes, a menu is a click to reach a single item. */}
                  {interject ? (
                    <PromptInput.Queue.Item.Action onPress={() => onSetDelivery(item.id, 'follow_up')}>
                      {t('chat.queue.followUp')}
                    </PromptInput.Queue.Item.Action>
                  ) : (
                    <PromptInput.Queue.Item.Steer onPress={() => onSetDelivery(item.id, 'interject')}>
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
