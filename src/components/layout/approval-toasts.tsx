import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Toast, ToastQueue } from '@heroui/react'
import type { QueuedToast } from 'react-aria-components'
import { ArrowRight, Check, Clock, Xmark } from '@gravity-ui/icons'

import { api } from '@/api'
import { ToolArgsSummary, toolDescription, toolLabel } from '@/components/chat/tool-call-block'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import { MAX_VISIBLE, visible } from './approval-queue'

/**
 * The waiting-on-you queue, drawn over whatever the reader is doing.
 *
 * The problem it answers is attention, not capability: with several
 * conversations working at once, every one of them can stop on a permission
 * prompt, and the only sign used to be a dot in the sidebar that did not say
 * what was being asked. Answering meant leaving the conversation being read.
 *
 * Two rules shape the rest of this file.
 *
 * **The system notification says there is something; this says what, and takes
 * the answer.** They are not the same message and neither replaces the other —
 * `use-global-event-listener` still sends the OS one, and it is the half that
 * works when the window is not on screen.
 *
 * **The conversation being read is not in the queue.** Its card is already in
 * the transcript, at the live edge the scroller follows. Two places to click for
 * one decision is worse than one, so `visible()` filters `activeId` out.
 *
 * Order is ours, not the queue's. `ToastQueue` is handed the front of
 * `attentionOrder` and nothing else, so "defer" is a defined operation —
 * moving an id to the end of a list we own — rather than a guess about where
 * `add` lands. It also keeps thirty questions from being thirty live toasts.
 */

/** What a row carries. `Toast.Provider` is generic over this, and the render
 *  prop below is the only thing that reads it. */
interface ApprovalToastContent extends Record<string, unknown> {
  item: AttentionItem
}

/** Module scope, like every toast queue: it outlives the component that draws
 *  it, and a queue rebuilt on re-render would drop whatever was on screen. */
const approvalQueue = new ToastQueue<ApprovalToastContent>({ maxVisibleToasts: MAX_VISIBLE })

/**
 * Keep `ToastQueue` in step with the store.
 *
 * Rebuilt rather than diffed, and **added back to front**. Both follow from how
 * the underlying queue works, which is not what it looks like from the outside:
 *
 * - `add` *unshifts* (`react-stately/dist/private/toast/useToastState.mjs`), and
 *   the frontmost toast — the only one that is not `pointer-events-none` and the
 *   only one in the tab order — is `visibleToasts[0]`. So the row added *last*
 *   is the one a person can actually press, and adding our queue front-first
 *   would bury the question that is next in line under two that are not.
 * - There is no reordering operation, only `add` and `close`. A diff by *set*
 *   therefore cannot express a reordering at all: deferring the front of three
 *   visible rows leaves the same three ids on screen, so a set diff finds
 *   nothing to do and the button does nothing.
 *
 * Rebuilding on every change of the *sequence* (not the set) is what makes both
 * correct. It costs a re-entry animation for rows that did not move, which is
 * the price of the queue being ours rather than the toast library's — and every
 * case that triggers it is a real change: a question arriving, one being
 * answered, one being deferred, or the reader moving to a conversation whose
 * questions are drawn on its own transcript instead.
 */
function useApprovalToasts(transcriptInert = false) {
  const attention = useConversationStore((s) => s.attention)
  const order = useConversationStore((s) => s.attentionOrder)
  const activeId = useConversationStore((s) => s.activeId)
  const activeReviewId = usePlanReviewStore((s) => s.activeReviewId)

  const shown = useMemo(
    () => visible(attention, order, activeId, transcriptInert, activeReviewId),
    [attention, order, activeId, transcriptInert, activeReviewId],
  )
  // Compared as a sequence. `shown` is a fresh array on every store change, so
  // without this the queue would be rebuilt when nothing about it had moved.
  // A review keeps the same queue id while it moves from a submitted plan to a
  // queued or failed continuation. Include that presentation state or the
  // module-scoped ToastQueue keeps the old content even though the store row
  // was replaced underneath it.
  const sequence = JSON.stringify(
    shown.map((item) => [item.approvalId, item.kind === 'plan_review' ? item.stage : null]),
  )
  const built = useRef<string | null>(null)

  useEffect(() => {
    if (built.current === sequence) return
    built.current = sequence
    approvalQueue.clear()
    for (let i = shown.length - 1; i >= 0; i--) {
      // `timeout: 0` is not a preference. A question that dismisses itself is a
      // turn left hanging with nothing on screen to say so.
      approvalQueue.add({ item: shown[i] }, { timeout: 0 })
    }
  }, [shown, sequence])
}

/** Mounted once by the shell. Renders nothing until something is waiting. */
export function ApprovalToastRegion({
  onSelect,
  transcriptInert = false,
}: {
  onSelect: (conversationId: string) => void
  transcriptInert?: boolean
}) {
  useApprovalToasts(transcriptInert)

  // `maxVisibleToasts` is read off the provider, not off the queue it was also
  // passed to — the queue keeps its copy but hands the react-stately one
  // `MAX_SAFE_INTEGER`, so the stack depth is decided here or not at all.
  return (
    <Toast.Provider placement="top" queue={approvalQueue} maxVisibleToasts={MAX_VISIBLE}>
      {({ toast }) => <ApprovalToast toast={toast} onSelect={onSelect} />}
    </Toast.Provider>
  )
}

function ApprovalToast({
  toast,
  onSelect,
}: {
  toast: QueuedToast<ApprovalToastContent>
  onSelect: (conversationId: string) => void
}) {
  const { t } = useTranslation()
  const item = toast.content.item
  const defer = useConversationStore((s) => s.deferAttention)
  const retireAnswered = useConversationStore((s) => s.retireAnsweredApproval)
  const markOrphaned = useConversationStore((s) => s.markApprovalOrphaned)
  const openPlanReview = usePlanReviewStore((s) => s.openReview)
  const title = useConversationStore((s) => s.conversations.find((c) => c.id === item.conversationId)?.title ?? null)

  const args = useMemo(() => {
    if (item.kind === 'plan_review') return {}
    try {
      const parsed: unknown = JSON.parse(item.arguments)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      // Arguments are complete by the time an approval is asked for — this is
      // not the mid-stream partial JSON the card has to cope with — but a tool
      // whose call did not parse is still a call somebody has to decide about.
      return {}
    }
  }, [item])

  const description = useMemo(() => (item.kind === 'plan_review' ? null : toolDescription(args)), [args, item.kind])
  const planReviewMessage =
    item.kind !== 'plan_review'
      ? null
      : item.stage === 'review'
        ? t('chat.plan.reviewReady')
        : item.stage === 'delivery_queued'
          ? t('planReview.deliveryQueued')
          : t('chat.plan.continuationNeedsAttention')

  // Retired in the store rather than remembered here, because for a delegated
  // run nothing else will ever do it: the question is filed under the parent
  // conversation and its result is emitted on the sub-agent's, so no event
  // matches. See `retireAnsweredApproval`.
  //
  // Optimistic and not reversible, which is the honest reading of the failure:
  // the backend only refuses once it has stopped holding that turn open, so the
  // question is dead either way. `markApprovalOrphaned` is what makes the card
  // say so.
  const decide = (send: () => Promise<void>) => {
    retireAnswered(item.approvalId)
    send().catch(() => markOrphaned(item.approvalId))
  }

  const view = () => {
    onSelect(item.conversationId)
    if (item.kind === 'plan_review') openPlanReview(item.reviewId)
    // Behind the reader, not gone: they are being taken to the card, and if they
    // leave without answering it the question is still owed.
    defer(item.approvalId)
  }

  return (
    <Toast data-slot="approval-toast" toast={toast} variant="warning">
      {/* `min-w-0` and the two `w-full` below are what make the truncation
          underneath them work at all, and neither is ours to leave out.
          `.toast__content` is a flex item of `.toast` with `grow` and no
          `min-width: 0`, so its automatic minimum size is its content — and it
          is itself `flex-col items-start`, which sizes its children to their
          content rather than stretching them. A one-line `run_command` would
          therefore push straight through a toast whose own width is fixed
          (`.toast` is absolute with `inset-inline: 0`, so the region never
          grows) and get drawn past the edge of the window. */}
      <Toast.Content data-slot="approval-toast-content" className="min-w-0">
        <Toast.Title data-slot="approval-toast-title" className="w-full truncate">
          {title ?? t('chat.newChat')}
        </Toast.Title>
        <Toast.Description data-slot="approval-toast-description" className="w-full">
          {item.kind === 'plan_review' ? (
            <span className="font-medium leading-5">{planReviewMessage}</span>
          ) : (
            <span className="flex min-w-0 items-start gap-1.5">
              <span className="shrink-0 font-medium leading-5">{toolLabel(t, item.toolName)}</span>
              {/* Two lines of the whole value, never the key's compact form:
                  this row is a decision, and the summary is what it rests on.
                  The clamp is the container's, the way the card's trigger
                  applies its own. */}
              <ToolArgsSummary
                toolName={item.toolName}
                args={args}
                className="line-clamp-2 [display:-webkit-box] whitespace-pre-wrap [overflow-wrap:anywhere]"
              />
            </span>
          )}
          {/* Under the name, exactly as the card draws it. The row this replaces
              is a decision, so what the call *is* keeps the first line and what
              it is *for* gets the second — the reverse hid the path a
              `write_file` was being approved for. */}
          {description !== null && <span className="mt-0.5 line-clamp-2 break-words text-xs">{description}</span>}
          {/* The sandbox asked once already and was refused by the sandbox, not
              by a person. Without this the second question looks identical to
              the first. */}
          {item.kind !== 'plan_review' && item.retryReason !== undefined && (
            <span className="mt-1 block text-xs">{t('chat.tool.sandboxRetryPrompt')}</span>
          )}
        </Toast.Description>
        {/* Wraps, because the row does not fit on a phone. A toast is
            `calc(100vw - 2rem)` wide and its padding leaves about 264px at
            360px, against four buttons whose labels are set by whatever the
            question is — the sandbox retry spells its Allow "Retry without
            sandbox" on its own. HeroUI buttons are `whitespace-nowrap`, and a
            frontmost toast does not clip, so the overflow was drawn outside the
            rounded edge rather than being hidden. */}
        <div data-slot="approval-toast-actions" className="mt-2 flex flex-wrap items-center gap-2">
          {/* Left of the decisions, and the only way past a row without making
              one. No `Toast.CloseButton` beside it: two ways to say "not now"
              where one of them is irreversible is how a question gets lost. */}
          <Button size="sm" variant="ghost" onPress={() => defer(item.approvalId)}>
            <Clock className="size-3.5" />
            {t('chat.approvalToast.defer')}
          </Button>
          <Button size="sm" variant="ghost" onPress={view}>
            <ArrowRight className="size-3.5" />
            {item.kind === 'ask'
              ? t('chat.approvalToast.answer')
              : item.kind === 'plan_review'
                ? t('chat.plan.review')
                : t('chat.approvalToast.view')}
          </Button>
          {/* A question with a form behind it cannot be answered from a row, so
              it is offered as a way in and nothing else. It is in the queue at
              all because it stops a turn exactly as an approval does. */}
          {item.kind === 'approval' && (
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-danger hover:text-danger"
                onPress={() => decide(() => api.denyToolCall({ approvalId: item.approvalId, reason: null }))}
              >
                <Xmark className="size-3.5" />
                {t('chat.tool.deny')}
              </Button>
              <Button size="sm" onPress={() => decide(() => api.approveToolCall(item.approvalId))}>
                <Check className="size-3.5" />
                {item.retryReason !== undefined ? t('chat.tool.retryWithoutSandbox') : t('chat.tool.allow')}
              </Button>
            </div>
          )}
        </div>
      </Toast.Content>
    </Toast>
  )
}
