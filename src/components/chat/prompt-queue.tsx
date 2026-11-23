import './prompt-queue.css'
import { useTranslation } from 'react-i18next'
import { Reorder, useDragControls } from 'motion/react'
import { Button as AriaButton } from 'react-aria-components'
import { Check, CircleQuestion, Clock, GripVertical, Paperclip, TriangleAlert, X } from '@keyline-icons/react/two-tone'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'

import { isCoarsePointer } from '@/hooks/use-coarse-pointer'
import { queueState } from '@/hooks/use-prompt-queue'
import { attachedParts, parseUserContent, type UserContentPart } from '@/lib/message-content'
import { titleIfTruncated } from '@/lib/truncation'
import type { QueueDelivery, QueuedPromptInfoResponse } from '@/types'
import { TodoCurrentRow } from './todo-bar'
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
 * The mark for a steered row, shared by the row's own icon and the Steer
 * button's children so both draw the same glyph rather than two copies of the
 * raw "↳" drifting apart.
 */
function SteerMark() {
  return (
    <span aria-hidden className="m-prompt-queue__steer-mark" data-slot="queue-steer-mark">
      ↳
    </span>
  )
}

/** What one attachment is called on a queued row. */
function attachmentName(part: UserContentPart, image: string): string {
  if (part.type === 'file') return part.file?.name ?? ''
  if (part.type === 'sticker') return part.name ?? ''
  return image
}

function isMovable(item: QueuedPromptInfoResponse): boolean {
  const state = queueState(item)
  return state !== 'in_doubt' && state !== 'settled' && state !== 'held'
}

function PromptQueueRow({
  item,
  index,
  items,
  onMove,
  onRemove,
  onSetDelivery,
}: {
  item: QueuedPromptInfoResponse
  index: number
  items: QueuedPromptInfoResponse[]
  onMove: (index: number, offset: -1 | 1) => void
  onRemove: (id: string) => void
  onSetDelivery: (id: string, delivery: QueueDelivery) => void
}) {
  const { t } = useTranslation()
  const dragControls = useDragControls()
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
  // The stored envelope, read back as what was written plus what was
  // attached — never the JSON, which carries local file paths. An
  // attachment-only message has no text, so its names stand in.
  const { parts, text } = parseUserContent(item.content)
  const attached = attachedParts(parts)
  const label = text || attached.map((part) => attachmentName(part, t('chat.queue.image'))).join(', ')

  return (
    <Reorder.Item
      value={item}
      as="li"
      dragListener={false}
      dragControls={pinned ? undefined : dragControls}
      data-slot="prompt-input-queue-item"
      className="m-prompt-queue__item"
    >
      {/* No handle on a row that must not move. A settled row's position means
          nothing, and a doubtful one is the barrier that stops everything
          behind it from running on a premise nobody has confirmed. */}
      {!pinned && (
        <span
          aria-hidden
          data-slot="prompt-input-queue-item-handle"
          className="m-prompt-queue__handle"
          onPointerDown={(e) => {
            e.preventDefault()
            dragControls.start(e)
          }}
        >
          <GripVertical aria-hidden className="m-prompt-queue__handle-icon" />
        </span>
      )}
      <div data-slot="prompt-input-queue-item-body" data-delivery={item.delivery} className="m-prompt-queue__body">
        {/* For a doubtful row the icon is the doubt rather than the mode: what
            happens to it next is the only thing about it still undecided. An
            interjection uses the same ↳ as the Steer button. */}
        <div data-slot="prompt-input-queue-item-icon" className="m-prompt-queue__icon">
          {doubtful ? (
            <CircleQuestion className="m-prompt-queue__glyph" data-tone="warning" />
          ) : taken ? (
            <Check className="m-prompt-queue__glyph" data-tone="muted" />
          ) : interject ? (
            <SteerMark />
          ) : (
            <Clock className="m-prompt-queue__glyph" />
          )}
        </div>
        <div
          data-slot="prompt-input-queue-item-content"
          onPointerEnter={titleIfTruncated}
          className="m-prompt-queue__content"
        >
          {label}
        </div>
        {/* Why there is no Steer on this row as well as what it carries: an
            interjection is text, and the backend refuses the switch. */}
        {attached.length > 0 && !settled && (
          <span data-slot="queue-attachments" className="m-prompt-queue__description m-prompt-queue__attachments">
            <Paperclip aria-hidden className="m-prompt-queue__attachment-icon" />
            {t('chat.queue.attachments', { count: attached.length })}
          </span>
        )}
        {doubtful && (
          <span
            data-slot="prompt-input-queue-item-description"
            data-tone="warning"
            className="m-prompt-queue__description"
          >
            {t('chat.queue.inDoubt')}
          </span>
        )}
        {taken && (
          <span data-slot="prompt-input-queue-item-description" className="m-prompt-queue__description">
            {t('chat.queue.taken')}
          </span>
        )}
      </div>
      {/* Neither of the settled states gets any actions. */}
      {!settled && (
        <div data-slot="prompt-input-queue-item-actions" className="m-prompt-queue__actions">
          {!pinned && (
            <>
              <span className="m-prompt-queue__action">
                <Button
                  data-slot="prompt-input-queue-item-action"
                  variant="secondary"
                  size="sm"
                  isDisabled={index === 0 || !isMovable(items[index - 1])}
                  onPress={() => onMove(index, -1)}
                >
                  {t('chat.queue.moveUp')}
                </Button>
              </span>
              <span className="m-prompt-queue__action">
                <Button
                  data-slot="prompt-input-queue-item-action"
                  variant="secondary"
                  size="sm"
                  isDisabled={index === items.length - 1 || !isMovable(items[index + 1])}
                  onPress={() => onMove(index, 1)}
                >
                  {t('chat.queue.moveDown')}
                </Button>
              </span>
            </>
          )}
          {interject ? (
            <span className="m-prompt-queue__action">
              <Button
                data-slot="prompt-input-queue-item-action"
                variant="secondary"
                size="sm"
                onPress={() => onSetDelivery(item.id, 'follow_up')}
              >
                {t('chat.queue.followUp')}
              </Button>
            </span>
          ) : attached.length > 0 ? null : (
            <AriaButton
              data-slot="prompt-input-queue-item-steer"
              className="m-prompt-queue__steer"
              onPress={() => onSetDelivery(item.id, 'interject')}
            >
              <SteerMark />
              {t('chat.queue.interject')}
            </AriaButton>
          )}
          <span className="m-prompt-queue__remove">
            <Button
              data-slot="prompt-input-queue-item-remove"
              variant="ghost"
              size="sm"
              icon={<X />}
              aria-label={t('chat.queue.remove')}
              onPress={() => onRemove(item.id)}
            />
          </span>
        </div>
      )}
    </Reorder.Item>
  )
}

/**
 * The messages stacked up above the composer, in the order they will be sent.
 *
 * One card with the *current* run at the top and the stacked messages under
 * it. The two delivery modes are not urgency levels, and they are not the
 * same shape either:
 *
 * - **`interject`** hangs off the current row with `↳`, because it goes
 *   in at the next gap of the turn already running.
 * - **`follow_up`** is an ordinary queued row, and its one action is Steer —
 *   the word for switching it to an interjection, which also delivers it.
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
    <div data-slot="queue-current" className="m-prompt-queue__current">
      <TodoCurrentRow todos={currentTodos} />
    </div>
  ) : streaming ? (
    <div data-slot="queue-current" className="m-prompt-queue__current m-prompt-queue__current--running">
      <span aria-hidden>
        <Spinner size="sm" />
      </span>
      <span data-slot="queue-running-label">{t('chat.queue.running')}</span>
    </div>
  ) : null

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= items.length || !isMovable(items[index]) || !isMovable(items[target])) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onReorder(next)
  }

  const handleReorder = (next: QueuedPromptInfoResponse[]) => {
    const pinnedBefore = items.map((it, i) => (!isMovable(it) ? `${it.id}:${i}` : null)).filter(Boolean)
    const pinnedAfter = next.map((it, i) => (!isMovable(it) ? `${it.id}:${i}` : null)).filter(Boolean)
    if (pinnedBefore.length !== pinnedAfter.length || pinnedBefore.some((v, i) => v !== pinnedAfter[i])) return
    onReorder(next)
  }

  return (
    <div
      data-slot="prompt-input-queue"
      data-actions={isCoarsePointer() ? 'always' : 'hover'}
      className="m-prompt-queue"
    >
      {held && (
        <div data-slot="queue-held" className="m-prompt-queue__held" role="status">
          <TriangleAlert aria-hidden className="m-prompt-queue__held-icon" />
          <span data-slot="queue-held-label" className="m-prompt-queue__held-label">
            {t('chat.queue.held')}
          </span>
          {/* The only way to restart a held queue; the expanded hit area is
              what makes it reachable with a finger. */}
          <span className="m-prompt-queue__release">
            <Button size="sm" variant="secondary" onPress={onRelease}>
              {t('chat.queue.release')}
            </Button>
          </span>
        </div>
      )}
      {current}
      <Reorder.Group
        axis="y"
        as="ul"
        values={items}
        onReorder={handleReorder}
        data-slot="prompt-input-queue-list"
        aria-label={t('chat.queue.label')}
        className="m-prompt-queue__list"
      >
        {items.map((item, index) => (
          <PromptQueueRow
            key={item.id}
            item={item}
            index={index}
            items={items}
            onMove={move}
            onRemove={onRemove}
            onSetDelivery={onSetDelivery}
          />
        ))}
      </Reorder.Group>
    </div>
  )
}
