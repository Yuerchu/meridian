import type { TFunction } from 'i18next'
import { useMemo } from 'react'

import { api } from '@/api'
import { identifyingArg, toolDescription, type IdentifyingArg } from '@/components/chat/tool-call-block'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import { errorMessage } from '@/lib/error-message'

/**
 * How many questions are on screen at once.
 *
 * Each is a full notification with its own buttons, stacked in the shell's
 * `NotificationViewport`. The rest of the queue is not drawn there — thirty
 * questions would otherwise be thirty cards covering the window to say the
 * same thing — and deferring one brings the next into view. The whole queue is
 * the inbox's (`notification-inbox.tsx`), read off the same `pending()`.
 */
export const MAX_VISIBLE = 3

/**
 * What the queue holds, split by where each question is answered.
 *
 * `listed` is everything the two outer surfaces offer, front first: the
 * floating stack draws its first `MAX_VISIBLE`, the inbox draws all of it.
 * `here` is what the conversation being read is waiting on — its cards are in
 * the transcript in front of the reader, so neither surface lists them, and the
 * inbox says only that they exist.
 *
 * Split out from the components it serves so its tests do not have to mount
 * one. The exclusions are the whole policy, and neither fails in a way anybody
 * would see: a question that should have been filtered out just draws, and one
 * that should have been offered just does not.
 */
export function pending(
  attention: Record<string, AttentionItem>,
  order: string[],
  activeId: string | null,
  transcriptInert = false,
  activeReviewId: string | null = null,
): { listed: AttentionItem[]; here: AttentionItem[] } {
  const listed: AttentionItem[] = []
  const here: AttentionItem[] = []
  for (const id of order) {
    const item = attention[id]
    // The order is written independently of the map, so an id can outlive the
    // entry it names for the span of one update.
    if (!item) continue
    // The review page being read. It is the whole of what this row offers, so
    // listing it would only be a second way onto the page already on screen —
    // and unlike the transcript case, the page is never inert while it is open.
    if (item.kind === 'plan_review' && item.reviewId === activeReviewId) continue
    // Already in the transcript being read, at the live edge the scroller
    // follows. Two places to click for one decision is worse than one.
    // Settings covers that transcript with `inert`, so the card is not
    // reachable and this exclusion would hide the only remaining way in.
    if (item.conversationId === activeId && !transcriptInert) {
      here.push(item)
      continue
    }
    listed.push(item)
  }
  return { listed, here }
}

/** The front of `pending().listed`: what the floating stack draws. */
export function visible(
  attention: Record<string, AttentionItem>,
  order: string[],
  activeId: string | null,
  transcriptInert = false,
  activeReviewId: string | null = null,
): AttentionItem[] {
  return pending(attention, order, activeId, transcriptInert, activeReviewId).listed.slice(0, MAX_VISIBLE)
}

/** `pending()` over the live stores. */
export function usePendingAttention(transcriptInert: boolean): { listed: AttentionItem[]; here: AttentionItem[] } {
  const attention = useConversationStore((s) => s.attention)
  const order = useConversationStore((s) => s.attentionOrder)
  const activeId = useConversationStore((s) => s.activeId)
  const activeReviewId = usePlanReviewStore((s) => s.activeReviewId)
  return useMemo(
    () => pending(attention, order, activeId, transcriptInert, activeReviewId),
    [attention, order, activeId, transcriptInert, activeReviewId],
  )
}

/** `visible()` over the live stores, for the shell's notification stack. */
export function useVisibleApprovals(transcriptInert: boolean): AttentionItem[] {
  const { listed } = usePendingAttention(transcriptInert)
  return useMemo(() => listed.slice(0, MAX_VISIBLE), [listed])
}

/**
 * The inbox's two tabs besides "all". A tool approval asks for a yes or a no;
 * everything else — `ask_user`, an ACP elicitation, a plan review — asks for
 * an answer that has a form or a page behind it.
 */
export type AttentionCategory = 'approvals' | 'questions'

export function attentionCategory(item: AttentionItem): AttentionCategory {
  return item.kind === 'approval' ? 'approvals' : 'questions'
}

/**
 * How much of a call's summary a notification may show and still offer the
 * decision itself. A decision cannot rest on something the reader did not see,
 * and past this a notification would have to clip — or scroll inside a fixed
 * stack, which is a clip the reader has to notice. So a longer call is shown
 * shortened and offered only as a way into its card, which shows all of it.
 */
export const INLINE_DECISION_LIMIT = { chars: 240, lines: 4 }

export function fitsInline(text: string | null): boolean {
  if (text === null) return true
  return text.length <= INLINE_DECISION_LIMIT.chars && text.split('\n').length <= INLINE_DECISION_LIMIT.lines
}

/** A call's arguments as an object; `{}` when they are not one. */
export function attentionArgs(item: AttentionItem): Record<string, unknown> {
  if (item.kind === 'plan_review') return {}
  try {
    const parsed: unknown = JSON.parse(item.arguments)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    // Arguments are complete by the time an approval is asked for — this is
    // not the mid-stream partial JSON the card has to cope with — but a tool
    // whose call did not parse is still a call somebody has to decide about,
    // from its card. Nothing parsed is nothing shown, which `hidden` reads.
    return {}
  }
}

/**
 * The calls a row may decide without its card, and which of their arguments it
 * draws besides the identifying one.
 *
 * **Risk decides, not how many arguments there are.** A row can show a short
 * `run_command` in full and it is still the call most worth reading in its
 * context — what ran before it, what the turn is for, which directory it lands
 * in — so anything with a side effect is offered only as a way into its card:
 * running a command (`run_command`, `Bash`, `SlashCommand`), writing, editing,
 * moving or deleting a file, `apply_patch`, anything that reaches the network
 * (`web_search`, `WebFetch`), MCP and custom tools, QQ writes, and any tool the
 * app does not recognise. A call that asks to leave the sandbox — an escalation
 * retry, or `dangerouslyDisableSandbox` — is never decided here either.
 *
 * What is on this list only reads: it can show the reader something they were
 * not meant to see, and the path is what they judge that on. So it may be
 * decided here **when the row shows every argument it carries**. The keys listed
 * for a tool are the ones that only narrow what is read — a search's directory,
 * `Read`'s offset and limit, `Grep`'s filters — and the row draws each of them
 * under the identifying argument. Anything else the call carries is still
 * hidden, which withdraws the decision as it always has.
 */
export const READ_ONLY_TOOLS: Readonly<Record<string, readonly string[]>> = {
  read_file: [],
  list_directory: [],
  // `path` is required here and is what decides where the search reads.
  search_files: ['path', 'max_results'],
  glob: ['path'],
  Read: ['offset', 'limit', 'pages'],
  Glob: ['path'],
  Grep: ['path', 'glob', 'type', 'output_mode', '-i', '-n', '-A', '-B', '-C', 'multiline', 'head_limit'],
}

/** An argument a row draws beside the identifying one, as it will be read. */
export interface AttentionScopeArg {
  key: string
  value: string
}

/** Why a tool approval is offered only as a way into its card. */
export type AttentionWithheld = 'risky' | 'hidden' | 'too_long'

/**
 * What a row outside the transcript can show of a question, and whether the
 * decision itself may be offered there.
 *
 * A row shows the identifying argument (`ToolArgsSummary`), the one-line
 * description and — for a tool on `READ_ONLY_TOOLS` — the scope arguments that
 * list names. Allow/Deny is offered only when all three hold: the tool only
 * reads, nothing the call carries is off screen (`hidden`), and what is on
 * screen fits without clipping (`fits`, `INLINE_DECISION_LIMIT`).
 */
export interface AttentionShape {
  args: Record<string, unknown>
  identifying: IdentifyingArg | null
  description: string | null
  /** The read-only tool's narrowing arguments, drawn under the call. */
  scope: AttentionScopeArg[]
  /** The shown parts fit the row without clipping. */
  fits: boolean
  /** Part of what the call will do is not shown by the row at all. */
  hidden: boolean
  /** The call has a side effect, asks to leave the sandbox, or is not known. */
  risky: boolean
  /** Why the decision is withheld; `null` when it is offered or was never a decision. */
  withheld: AttentionWithheld | null
  /** Allow/Deny may be offered in the row. */
  decidable: boolean
}

export function attentionShape(item: AttentionItem): AttentionShape {
  if (item.kind === 'plan_review') {
    return {
      args: {},
      identifying: null,
      description: null,
      scope: [],
      fits: true,
      hidden: false,
      risky: false,
      withheld: null,
      decidable: false,
    }
  }
  const args = attentionArgs(item)
  const identifying = identifyingArg(item.toolName, args)
  const description = toolDescription(args)
  const scopeKeys = Object.prototype.hasOwnProperty.call(READ_ONLY_TOOLS, item.toolName)
    ? READ_ONLY_TOOLS[item.toolName]
    : null
  const risky = scopeKeys === null || item.retry !== undefined
  const scope: AttentionScopeArg[] = []
  for (const key of scopeKeys ?? []) {
    const value = args[key]
    // Only a scalar is drawn as it will be read; anything else stays unseen,
    // and the check below counts it as hidden.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      scope.push({ key, value: String(value) })
    }
  }
  const shownScope = new Set(scope.map((arg) => arg.key))
  const fits =
    fitsInline(identifying?.value ?? null) &&
    fitsInline(description) &&
    fitsInline(scope.length === 0 ? null : scope.map((arg) => `${arg.key} ${arg.value}`).join('\n'))
  const hidden =
    identifying === null ||
    // Derived rather than read (an `apply_patch`'s file name): the value shown
    // stands for an argument that is not.
    identifying.key === null ||
    Object.entries(args).some(
      ([key, value]) =>
        key !== identifying.key &&
        !shownScope.has(key) &&
        // Shown on its own line — but only a string is, so anything else under
        // that name is as unseen as any other argument.
        !(key === 'description' && typeof value === 'string') &&
        value !== null &&
        value !== undefined,
    )
  const withheld: AttentionWithheld | null =
    item.kind !== 'approval' ? null : risky ? 'risky' : hidden ? 'hidden' : !fits ? 'too_long' : null
  return {
    args,
    identifying,
    description,
    scope,
    fits,
    hidden,
    risky,
    withheld,
    decidable: item.kind === 'approval' && withheld === null,
  }
}

/**
 * The buttons a row offers, in order. The same list for the floating
 * notification and the inbox, so the two cannot disagree about whether a call
 * may be decided without its card.
 *
 * `defer` is the only way past a row without making a decision; `view` takes
 * the reader to the card (or the form, or the review page); `deny` / `allow`
 * exist only when `attentionShape().decidable`.
 */
export type AttentionActionId = 'defer' | 'view' | 'deny' | 'allow'

export function attentionActionIds(shape: AttentionShape): AttentionActionId[] {
  return shape.decidable ? ['defer', 'view', 'deny', 'allow'] : ['defer', 'view']
}

export function isAttentionActionId(value: string): value is AttentionActionId {
  return value === 'defer' || value === 'view' || value === 'deny' || value === 'allow'
}

/** What a button says. The allow label changes for a sandbox escalation: the
 *  second question has to read differently from the first. */
export function attentionActionLabel(t: TFunction, item: AttentionItem, action: AttentionActionId): string {
  switch (action) {
    case 'defer':
      return t('chat.approvalNotification.defer')
    case 'view':
      return item.kind === 'ask'
        ? t('chat.approvalNotification.answer')
        : item.kind === 'plan_review'
          ? t('chat.plan.review')
          : t('chat.approvalNotification.view')
    case 'deny':
      return t('chat.tool.deny')
    case 'allow':
      return item.kind !== 'plan_review' && item.retry !== undefined
        ? t('chat.tool.retryWithoutSandbox')
        : t('chat.tool.allow')
  }
}

/** How each button is painted, the same on both surfaces. */
export const ACTION_VARIANT = { defer: 'secondary', view: 'secondary', deny: 'danger', allow: 'primary' } as const

/**
 * What each action does, shared by both surfaces. `onSelect` is the shell's
 * navigation: it opens the conversation (and closes settings), and resolves
 * `false` when leaving wherever the reader was got refused.
 */
export function useAttentionActions(onSelect: (conversationId: string) => Promise<boolean>) {
  const defer = useConversationStore((s) => s.deferAttention)
  const retireAnswered = useConversationStore((s) => s.retireAnsweredApproval)
  const markOrphaned = useConversationStore((s) => s.markApprovalOrphaned)
  const openPlanReview = usePlanReviewStore((s) => s.openReview)

  // Retired in the store rather than remembered here, because for a delegated
  // run nothing else will ever do it: the question is filed under the parent
  // conversation and its result is emitted on the sub-agent's, so no event
  // matches. See `retireAnsweredApproval`.
  //
  // Optimistic and not reversible, which is the honest reading of the failure:
  // the backend only refuses once it has stopped holding that turn open, so the
  // question is dead either way. `markApprovalOrphaned` is what makes the card
  // say so.
  const decide = (item: AttentionItem, send: () => Promise<void>) => {
    retireAnswered(item.approvalId)
    // The reason lands on the card, which is where the reader goes next: the
    // notification that was pressed has already left the stack.
    send().catch((err: unknown) => markOrphaned(item.approvalId, errorMessage(err)))
  }

  return (item: AttentionItem, action: AttentionActionId) => {
    switch (action) {
      case 'defer':
        defer(item.approvalId)
        return
      case 'view':
        // The review opens only once the navigation has finished. Navigating is
        // asynchronous — it asks settings about unsaved work, and an open review
        // about its draft — and its last step closes whatever review was open,
        // so a review opened alongside it was opened just in time to be closed.
        void onSelect(item.conversationId).then((navigated) => {
          if (navigated && item.kind === 'plan_review') openPlanReview(item.reviewId)
        })
        // Behind the reader, not gone: they are being taken to the card, and if
        // they leave without answering it the question is still owed.
        defer(item.approvalId)
        return
      case 'deny':
        decide(item, () => api.denyToolCall({ approvalId: item.approvalId, reason: null }))
        return
      case 'allow':
        decide(item, () => api.approveToolCall(item.approvalId))
        return
    }
  }
}
