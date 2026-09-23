import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Notification, NotificationViewport, type NotificationAction } from '@/components/base'
import { ArrowRight, Check, Clock, X } from '@keyline-icons/react/two-tone'

import { ToolArgsSummary, toolLabel } from '@/components/chat/tool-call-block'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import {
  ACTION_VARIANT,
  attentionActionIds,
  attentionActionLabel,
  attentionShape,
  useAttentionActions,
  useVisibleApprovals,
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
 * top of what is being typed. The official viewport does not know about
 * safe-area insets, so the top offset is widened to clear the status bar here
 * rather than in the vendored file. Its `z-100` is the registry's own.
 */
export function ApprovalNotifications({
  onSelect,
  transcriptInert = false,
}: {
  onSelect: (conversationId: string) => void
  transcriptInert?: boolean
}) {
  const { t } = useTranslation()
  const approvals = useVisibleApprovals(transcriptInert)

  return (
    <NotificationViewport
      data-slot="approval-notifications"
      role="region"
      aria-label={t('notifications.region')}
      position="top-center"
      className="top-[max(0.75rem,var(--safe-top,0px))] sm:top-[max(1.5rem,var(--safe-top,0px))]"
    >
      {approvals.map((item) => (
        <ApprovalNotification key={item.approvalId} item={item} onSelect={onSelect} />
      ))}
    </NotificationViewport>
  )
}

const ACTION_ICON = { defer: Clock, view: ArrowRight, deny: X, allow: Check } as const

export function ApprovalNotification({
  item,
  onSelect,
}: {
  item: AttentionItem
  onSelect: (conversationId: string) => void
}) {
  const { t } = useTranslation()
  const act = useAttentionActions(onSelect)
  const title = useConversationStore((s) => s.conversations.find((c) => c.id === item.conversationId)?.title ?? null)
  const shape = useMemo(() => attentionShape(item), [item])

  // Deferring is the only way past a row without making a decision, which is
  // why the notification is not dismissible: two ways to say "not now" where
  // one of them is irreversible is how a question gets lost.
  const actions: NotificationAction[] = attentionActionIds(shape).map((id) => {
    const Icon = ACTION_ICON[id]
    return {
      label: (
        <>
          <Icon className="size-3.5" aria-hidden />
          {attentionActionLabel(t, item, id)}
        </>
      ),
      variant: ACTION_VARIANT[id],
      onPress: () => act(item, id),
    }
  })

  return (
    <Notification
      data-slot="approval-notification"
      data-approval-id={item.approvalId}
      status="neutral"
      title={title ?? t('chat.newChat')}
      description={<AttentionSummary item={item} shape={shape} />}
      actions={actions}
      dismissible={false}
      introDelay={0}
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
 * It lands inside the row's `<p>`, so everything in it is a span.
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
      <span data-slot="approval-notification-call" className="flex min-w-0 items-start gap-1.5">
        <span data-slot="approval-notification-tool-name" className="shrink-0 text-body-2-medium leading-5">
          {toolLabel(t, item.toolName)}
        </span>
        {/* The whole value, never the key's compact form: this row is a
            decision, and the summary is what it rests on. Clamped only when it
            does not fit, and then the decision is not offered here. */}
        <ToolArgsSummary
          toolName={item.toolName}
          args={shape.args}
          className={
            shape.fits
              ? 'whitespace-pre-wrap [overflow-wrap:anywhere]'
              : 'line-clamp-3 [display:-webkit-box] whitespace-pre-wrap [overflow-wrap:anywhere]'
          }
        />
      </span>
      {/* Under the name, exactly as the card draws it: what the call *is*
          keeps the first line and what it is *for* gets the second — the
          reverse hid the path a `write_file` was being approved for. */}
      {shape.description !== null && (
        <span
          data-slot="approval-notification-tool-description"
          className={
            shape.fits
              ? 'mt-0.5 block break-words text-caption-1-regular'
              : 'mt-0.5 line-clamp-2 break-words text-caption-1-regular'
          }
        >
          {shape.description}
        </span>
      )}
      {/* Read-only tools only: the arguments that narrow what is read, each as
          it will be read. A decision offered here rests on them too. */}
      {shape.scope.length > 0 && (
        <span data-slot="approval-notification-scope" className="mt-0.5 block font-mono text-caption-1-regular">
          {shape.scope.map((arg) => (
            <span
              key={arg.key}
              data-slot="approval-notification-scope-arg"
              className="block whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              <span data-slot="approval-notification-scope-key" className="text-text-tertiary">
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
        <span data-slot={WITHHELD_SLOT[shape.withheld]} className="mt-1 block text-caption-1-regular">
          {t(WITHHELD_MESSAGE[shape.withheld])}
        </span>
      )}
      {/* The sandbox asked once already and was refused by the sandbox, not
          by a person. Without this the second question looks identical to
          the first. */}
      {item.retryReason !== undefined && (
        <span data-slot="approval-notification-retry-prompt" className="mt-1 block text-caption-1-regular">
          {t('chat.tool.sandboxRetryPrompt')}
        </span>
      )}
    </>
  )
}
