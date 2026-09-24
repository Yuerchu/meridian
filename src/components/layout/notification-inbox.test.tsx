import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { onPendingReveal } from '@/lib/pending-reveal'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { ConversationInfoResponse } from '@/types'
import { NotificationInbox } from './notification-inbox'

const mocks = vi.hoisted(() => ({
  approve: vi.fn<(id: string) => Promise<void>>(),
  deny: vi.fn<(req: { approvalId: string; reason: string | null }) => Promise<void>>(),
}))

vi.mock('@/api', () => ({
  api: { approveToolCall: mocks.approve, denyToolCall: mocks.deny },
}))

function call(
  approvalId: string,
  conversationId: string,
  args: Record<string, unknown> = { path: 'src/a.ts' },
  toolName = 'read_file',
  kind: 'approval' | 'ask' = 'approval',
): AttentionItem {
  return {
    approvalId,
    conversationId,
    providerCallId: `call-${approvalId}`,
    messageId: `message-${approvalId}`,
    toolName,
    arguments: JSON.stringify(args),
    kind,
    askedAt: Date.now(),
  }
}

function seed(items: AttentionItem[], activeId: string | null = null) {
  const ids = [...new Set([...items.map((i) => i.conversationId), ...(activeId ? [activeId] : [])])]
  useConversationStore.setState({
    conversations: ids.map((id) => ({ id, title: `Title ${id}` }) as ConversationInfoResponse),
    activeId,
    attention: Object.fromEntries(items.map((i) => [i.approvalId, i])),
    attentionOrder: items.map((i) => i.approvalId),
  })
}

/** The number drawn on the glyph: the registry bell's badge, beside the button. */
function badge(): string {
  return bell().parentElement?.querySelector('span.pointer-events-none')?.textContent ?? ''
}

function bell(): HTMLElement {
  return screen.getByRole('button', { name: /^Waiting on you/ })
}

async function open() {
  await userEvent.click(bell())
  return screen.findByRole('dialog', { name: i18n.t('notifications.inbox.title') })
}

/** The inbox's rows, by the title the center gives each (the conversation). */
function rows(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>('article')]
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  mocks.approve.mockReset().mockResolvedValue(undefined)
  mocks.deny.mockReset().mockResolvedValue(undefined)
  usePlanReviewStore.setState({ activeReviewId: null })
})

describe('the bell', () => {
  it('names the count and draws it on the glyph', () => {
    seed([call('a', 'c1'), call('b', 'c2')])
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    expect(bell()).toHaveAccessibleName(i18n.t('notifications.inbox.bell', { count: 2 }))
    expect(badge()).toBe('2')
  })

  /** Three digits would not fit the glyph, and past a hundred the exact
   *  number says nothing the bell's name does not. */
  it('caps the drawn count at 99+ and names the real one', () => {
    seed(Array.from({ length: 120 }, (_, i) => call(`q${i}`, `c${i}`)))
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    expect(badge()).toBe('99+')
    expect(bell()).toHaveAccessibleName(i18n.t('notifications.inbox.bell', { count: 120 }))
  })

  it('draws 99 as it is', () => {
    seed(Array.from({ length: 99 }, (_, i) => call(`q${i}`, `c${i}`)))
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    expect(badge()).toBe('99')
  })

  it('draws no count when nothing is waiting', () => {
    seed([])
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    expect(bell()).toHaveAccessibleName(i18n.t('notifications.inbox.bell', { count: 0 }))
    expect(badge()).toBe('')
  })

  /** The count is what the list holds, so the conversation being read is not in it. */
  it('does not count the conversation being read', () => {
    seed([call('a', 'being-read'), call('b', 'c2')], 'being-read')
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    expect(badge()).toBe('1')
  })
})

describe('the inbox', () => {
  it('fills the popover and scrolls as one box bounded by the popover’s own max-height', async () => {
    seed(Array.from({ length: 12 }, (_, i) => call(`q${i}`, `c${i}`)))
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    const center = within(dialog).getByRole('region', { name: i18n.t('notifications.inbox.title') })

    // React Aria writes the room left in the viewport onto the popover inline;
    // the dialog takes it, and the center scrolls inside that.
    expect(dialog.parentElement?.style.maxHeight).toMatch(/px$/)
    expect(dialog).toHaveClass('flex', 'max-h-[inherit]', 'flex-col')
    expect(center).toHaveClass('max-w-none', 'min-h-0', 'overflow-y-auto')
    expect(center).not.toHaveClass('max-w-[430px]')
    // One scroller: the registry's fixed 516px list inside it is lifted, which
    // is what left the last rows out of reach in a short window.
    const scrollers = [...center.querySelectorAll('*')].filter((el) => el.classList.contains('overflow-y-auto'))
    expect(scrollers.every((el) => el.classList.contains('overflow-visible'))).toBe(true)
    expect([...center.querySelectorAll('*')].some((el) => el.classList.contains('max-h-[516px]'))).toBe(false)
  })

  it('lists the whole queue, past the three the stack shows', async () => {
    seed(['a', 'b', 'c', 'd', 'e'].map((id) => call(id, `c-${id}`)))
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    expect(rows(dialog)).toHaveLength(5)
    expect(within(dialog).getByText(i18n.t('notifications.inbox.pendingCount', { count: 5 }))).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Mark all read' })).toBeNull()
  })

  it('leaves out the conversation being read and says it is waiting instead', async () => {
    seed([call('a', 'being-read'), call('b', 'being-read'), call('c', 'c2')], 'being-read')
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    expect(rows(dialog).map((r) => r.querySelector('p')?.textContent)).toEqual(['Title c2'])
    expect(within(dialog).getByText(i18n.t('notifications.inbox.here', { count: 2 }))).toBeInTheDocument()
  })

  it('has no line about the conversation being read when it is not waiting', async () => {
    seed([call('c', 'c2')], 'quiet')
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    expect(dialog.querySelector('[data-slot="notification-inbox-here"]')).toBeNull()
  })

  it('asks the transcript to reveal the card, and closes', async () => {
    const reveal = vi.fn()
    const off = onPendingReveal(reveal)
    seed([call('a', 'being-read')], 'being-read')
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('notifications.inbox.jumpToCard') }))
    expect(reveal).toHaveBeenCalledWith('being-read')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    off()
  })

  /** Grouped by conversation: each group where its first question stands in the
   *  queue, and within a group the queue's order. */
  it('groups rows under their conversation, in the order of the queue', async () => {
    seed([call('a', 'c1'), call('b', 'c2'), call('c', 'c1'), call('d', 'c3'), call('e', 'c2')])
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    const list = rows(dialog)[0].parentElement!
    const sequence = [...list.children].map((el) =>
      el.tagName === 'ARTICLE' ? `row ${el.querySelector('p')?.textContent}` : `group ${el.textContent}`,
    )
    expect(sequence).toEqual([
      'group Title c1',
      'row Title c1',
      'row Title c1',
      'group Title c2',
      'row Title c2',
      'row Title c2',
      'group Title c3',
      'row Title c3',
    ])
    // Within the c1 group, a before c; the Allow on the first row answers a.
    await userEvent.click(within(rows(dialog)[0]).getByRole('button', { name: i18n.t('chat.tool.allow') }))
    expect(mocks.approve).toHaveBeenCalledWith('a')
  })

  it('counts approvals and questions in their own tabs', async () => {
    seed([
      call('a', 'c1'),
      call('b', 'c2'),
      call('q', 'c3', { questions: [] }, 'ask_user', 'ask'),
      {
        approvalId: 'review-1',
        reviewId: 'review-1',
        conversationId: 'c4',
        documentId: 'd',
        revisionId: 'r',
        turnId: 't',
        stage: 'review',
        kind: 'plan_review',
        askedAt: null,
      },
    ])
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    const tabs = within(dialog).getAllByRole('radio')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      `${i18n.t('notifications.inbox.tabAll')}4`,
      `${i18n.t('notifications.inbox.tabApprovals')}2`,
      `${i18n.t('notifications.inbox.tabQuestions')}2`,
    ])
    await userEvent.click(tabs[2])
    expect(rows(dialog).map((r) => r.querySelector('p')?.textContent)).toEqual(['Title c3', 'Title c4'])
  })

  it('drops a row once it is answered', async () => {
    seed([call('a', 'c1'), call('b', 'c2')])
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    await userEvent.click(within(rows(dialog)[0]).getByRole('button', { name: i18n.t('chat.tool.allow') }))
    expect(mocks.approve).toHaveBeenCalledWith('a')
    await waitFor(() => expect(rows(dialog).map((r) => r.querySelector('p')?.textContent)).toEqual(['Title c2']))
  })

  it('dispatches deny, defer and view to the same actions the notification uses', async () => {
    const onSelect = vi.fn().mockResolvedValue(true)
    seed([call('a', 'c1'), call('b', 'c2'), call('c', 'c3')])
    render(<NotificationInbox onSelect={onSelect} transcriptInert={false} />)
    const dialog = await open()

    await userEvent.click(within(rows(dialog)[0]).getByRole('button', { name: i18n.t('chat.tool.deny') }))
    expect(mocks.deny).toHaveBeenCalledWith({ approvalId: 'a', reason: null })
    await waitFor(() => expect(useConversationStore.getState().attentionOrder).toEqual(['b', 'c']))

    await userEvent.click(
      within(rows(dialog)[0]).getByRole('button', { name: i18n.t('chat.approvalNotification.defer') }),
    )
    expect(useConversationStore.getState().attentionOrder).toEqual(['c', 'b'])

    await userEvent.click(
      within(rows(dialog)[0]).getByRole('button', { name: i18n.t('chat.approvalNotification.view') }),
    )
    expect(onSelect).toHaveBeenCalledWith('c3')
    expect(useConversationStore.getState().attentionOrder).toEqual(['b', 'c'])
  })

  /** The inbox reads the same `attentionShape` as the floating stack: one case
   *  per category, so the two cannot drift apart. */
  it('withholds the decision from a call with a side effect, however short', async () => {
    seed([
      call('rc', 'c1', { command: 'ls' }, 'run_command'),
      call('w', 'c2', { path: 'a.ts', content: 'x' }, 'write_file'),
    ])
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    for (const row of rows(dialog)) {
      expect(within(row).queryByRole('button', { name: i18n.t('chat.tool.allow') })).toBeNull()
      expect(within(row).getByText(i18n.t('chat.approvalNotification.reviewRequired'))).toBeInTheDocument()
    }
  })

  it('withholds the decision from a read that carries something the row does not draw', async () => {
    seed([call('r', 'c1', { path: 'a.ts', encoding: 'latin1' })])
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    expect(within(rows(dialog)[0]).queryByRole('button', { name: i18n.t('chat.tool.allow') })).toBeNull()
    expect(within(rows(dialog)[0]).getByText(i18n.t('chat.approvalNotification.contentHidden'))).toBeInTheDocument()
  })

  it('offers the decision on a search whose directory it draws', async () => {
    seed([call('s', 'c1', { pattern: 'TODO', path: 'C:/work' }, 'search_files')])
    render(<NotificationInbox onSelect={async () => true} transcriptInert={false} />)
    const dialog = await open()
    expect(within(rows(dialog)[0]).getByRole('button', { name: i18n.t('chat.tool.allow') })).toBeInTheDocument()
    expect(rows(dialog)[0].querySelector('[data-slot="approval-notification-scope-arg"]')?.textContent).toBe(
      'path C:/work',
    )
  })
})
