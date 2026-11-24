import './approval-notifications.css'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/yuerchu-ui/components/button/button'
import {
  NotificationCard,
  NotificationStack,
} from '@/components/yuerchu-ui/components/notification-stack/notification-stack'
import { UndoToast } from './undo-toast'
import { ArrowRight, Check, Clock, X } from '@keyline-icons/react/two-tone'

import { ToolArgsSummary, escalationPromptKey, toolLabel } from '@/components/chat/tool-call-block'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import {
  ACTION_VARIANT,
  MAX_VISIBLE,
  attentionActionIds,
  attentionActionLabel,
  attentionShape,
  useAttentionActions,
  usePendingAttention,
  type AttentionShape,
} from './approval-queue'

/**
 * The waiting-on-you queue, drawn over whatever the reader is doing.
 *
 * The problem it answers is attention, not capability: with several
 * conversations working at once, every one of them can stop on a permission
 * prompt, and the only sign used to be a dot in the sidebar that did not say
 * what was being asked. Answering meant leaving the conversation being read.
 *
 * **The system notification says there is something; this says what, and takes
 * the answer.** They are not the same message and neither replaces the other —
 * `use-global-event-listener` still sends the OS one, and it is the half that
 * works when the window is not on screen.
 *
 * **Two exits, one derivation.** This stack draws the front `MAX_VISIBLE` of
 * `pending().listed`; the header's inbox (`notification-inbox.tsx`) draws all
 * of it. Both leave out the conversation being read — its card is already in
 * the transcript, at the live edge the scroller follows — and both offer the
 * same buttons from `attentionActionIds`.
 *
 * **What is drawn is derived, not synchronised.** The rows are read straight
 * off the store and rendered as the viewport's children, keyed by
 * `approvalId`. There is no second queue to keep in step, so "defer" — moving
 * an id to the end of a list we own — reorders the stack by the same render
 * that changed the order, and the viewport's layout spring moves the rows that
 * stayed rather than replaying their entrance.
 *
 * Top-centre. The bottom of the window is the composer's, and on Android the
 * soft keyboard's — a notification there is either under the keyboard or on
 * top of what is being typed. The stack starts below the frame's header, not
 * over it (`approval-notifications.css`), through the library's own
 * `--ui-notification-top`.
 *
 * **Under a modal it is not drawn at all, and that is the library's.** A modal
 * overlay makes every other child of `body` `inert`; the stack's dock watches
 * for that and hides itself, leaving the F6 landmarks too, so a row drawn above
 * a dialog that nobody can reach never happens. A non-modal popover sets
 * nothing and leaves the stack alone. The inbox is unaffected; it is a way in,
 * not a layer.
 *
 * **The undo offer is a Toast, not a row here.** It used to share this
 * stack's head; the library keeps Toasts at the edge and pending questions
 * beside them, so it is `UndoToast`, mounted beside the stack.
 *
 * **Ignoring takes a row off this stack and nowhere else.** The question is
 * still owed: it stays in `attention`, the inbox lists it and the sidebar dot
 * stays lit. `stackIgnored` is cleared with the question by `retireAttention`.
 */
export function ApprovalNotifications({
  onSelect,
  transcriptInert = false,
  boardOpen = false,
  inboxOpen = false,
}: {
  onSelect: (conversationId: string) => Promise<boolean>
  transcriptInert?: boolean
  /** The board is the page: its cards' questions are answered on it. */
  boardOpen?: boolean
  /** The inbox lists every row this stack would draw; while it is open the stack is a duplicate beside it. */
  inboxOpen?: boolean
}) {
  const { t } = useTranslation()
  const { listed } = usePendingAttention(transcriptInert, boardOpen)
  const ignored = useConversationStore((s) => s.stackIgnored)
  const approvals = useMemo(
    () => (inboxOpen ? [] : listed.filter((item) => !ignored[item.approvalId]).slice(0, MAX_VISIBLE)),
    [listed, ignored, inboxOpen],
  )

  return (
    <>
      <NotificationStack placement="top" collapsible aria-label={t('notifications.region')}>
        {approvals.map((item) => (
          <ApprovalNotification key={item.approvalId} item={item} onSelect={onSelect} />
        ))}
      </NotificationStack>
      <UndoToast />
    </>
  )
}

const ACTION_ICON = { defer: Clock, view: ArrowRight, deny: X, allow: Check } as const

export function ApprovalNotification({
  item,
  onSelect,
}: {
  item: AttentionItem
  onSelect: (conversationId: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const act = useAttentionActions(onSelect)
  const title = useConversationStore((s) => s.conversations.find((c) => c.id === item.conversationId)?.title ?? null)
  const shape = useMemo(() => attentionShape(item), [item])
  const ignoreOnStack = useConversationStore((s) => s.ignoreOnStack)

  // Two ways past a row without deciding: "later" sends it to the back of this
  // stack, the close button ("ignore") takes it off this stack. Neither loses
  // the question — it is still in the inbox and on the sidebar until answered.
  // Pressing a button does not remove the card: the answer writes the store,
  // and the row goes when the store says so.
  return (
    <NotificationCard
      heading={title ?? t('chat.newChat')}
      description={<AttentionSummary item={item} shape={shape} />}
      actions={attentionActionIds(shape).map((id) => {
        const Icon = ACTION_ICON[id]
        return (
          <Button key={id} size="sm" variant={ACTION_VARIANT[id]} icon={<Icon />} onPress={() => act(item, id)}>
            {attentionActionLabel(t, item, id)}
          </Button>
        )
      })}
      dismissLabel={t('chat.approvalNotification.ignore')}
      onDismiss={() => ignoreOnStack(item.approvalId)}
    />
  )
}

const WITHHELD_SLOT = {
  risky: 'approval-notification-review-required',
  hidden: 'approval-notification-content-hidden',
  too_long: 'approval-notification-too-long',
} as const

const WITHHELD_MESSAGE = {
  risky: 'chat.approvalNotification.reviewRequired',
  hidden: 'chat.approvalNotification.contentHidden',
  too_long: 'chat.approvalNotification.argumentsTooLong',
} as const

/**
 * What a row says about a question: the tool and its identifying argument, the
 * description under them, a read-only tool's scope arguments, and — when the
 * decision has been withdrawn from the row — why. Shared by the notification and the inbox, so a call reads the
 * same wherever it is offered.
 *
 * Spans throughout, so it also reads inside a row of text.
 */
export function AttentionSummary({ item, shape }: { item: AttentionItem; shape: AttentionShape }) {
  const { t } = useTranslation()
  if (item.kind === 'plan_review') {
    return (
      <span data-slot="approval-notification-plan-message">
        {item.stage === 'review'
          ? t('chat.plan.reviewReady')
          : item.stage === 'delivery_queued'
            ? t('planReview.deliveryQueued')
            : t('chat.plan.continuationNeedsAttention')}
      </span>
    )
  }
  return (
    <>
      <span data-slot="approval-notification-call" className="m-attention__call" data-clamped={shape.fits ? null : ''}>
        <span data-slot="approval-notification-tool-name" className="m-attention__tool">
          {toolLabel(t, item.toolName)}
        </span>
        {/* The whole value, never the key's compact form: this row is a
            decision, and the summary is what it rests on. Clamped only when it
            does not fit, and then the decision is not offered here. */}
        <ToolArgsSummary toolName={item.toolName} args={shape.args} className="m-attention__args" />
      </span>
      {/* Under the name, exactly as the card draws it: what the call *is*
          keeps the first line and what it is *for* gets the second — the
          reverse hid the path a `write_file` was being approved for. */}
      {shape.description !== null && (
        <span
          data-slot="approval-notification-tool-description"
          className="m-attention__description"
          data-clamped={shape.fits ? null : ''}
        >
          {shape.description}
        </span>
      )}
      {/* Read-only tools only: the arguments that narrow what is read, each as
          it will be read. A decision offered here rests on them too. */}
      {shape.scope.length > 0 && (
        <span data-slot="approval-notification-scope" className="m-attention__scope">
          {shape.scope.map((arg) => (
            <span key={arg.key} data-slot="approval-notification-scope-arg" className="m-attention__scope-arg">
              <span data-slot="approval-notification-scope-key" className="m-attention__scope-key">
                {arg.key}
              </span>{' '}
              {arg.value}
            </span>
          ))}
        </span>
      )}
      {/* Only a tool approval is ever withheld; a question with a form behind
          it was never going to be answered from a row. */}
      {shape.withheld !== null && (
        <span data-slot={WITHHELD_SLOT[shape.withheld]} className="m-attention__note">
          {t(WITHHELD_MESSAGE[shape.withheld])}
        </span>
      )}
      {/* A second question about a call already approved: the sandbox refused
          it, or the settings that say where it runs could not be read. Without
          this the second question looks identical to the first. */}
      {item.retry !== undefined && (
        <span data-slot="approval-notification-retry-prompt" className="m-attention__note">
          {t(escalationPromptKey(item.retry.kind))}
        </span>
      )}
    </>
  )
}
