import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { Dialog, Modal, ModalOverlay, Popover } from 'react-aria-components'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { ConversationInfoResponse } from '@/types'
import { ApprovalNotifications } from './approval-notifications'
import { INLINE_DECISION_LIMIT } from './approval-queue'
import { NotificationInbox } from './notification-inbox'

const mocks = vi.hoisted(() => ({
  approve: vi.fn<(id: string) => Promise<void>>(),
  deny: vi.fn<(req: { approvalId: string; reason: string | null }) => Promise<void>>(),
}))

vi.mock('@/api', () => ({
  api: { approveToolCall: mocks.approve, denyToolCall: mocks.deny },
}))

/** A call the row may decide: a read with only its path. */
function approval(approvalId: string, conversationId: string, path = 'src/a.ts'): AttentionItem {
  return call(approvalId, conversationId, 'read_file', { path })
}

function call(
  approvalId: string,
  conversationId: string,
  toolName: string,
  args: Record<string, unknown> | string,
  kind: 'approval' | 'ask' = 'approval',
): AttentionItem {
  return {
    approvalId,
    conversationId,
    providerCallId: `call-${approvalId}`,
    messageId: `message-${approvalId}`,
    toolName,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
    kind,
    askedAt: null,
  }
}

function reviewAttention(stage: Extract<AttentionItem, { kind: 'plan_review' }>['stage']): AttentionItem {
  return {
    approvalId: 'review-1',
    reviewId: 'review-1',
    conversationId: 'conversation-1',
    documentId: 'document-1',
    revisionId: 'revision-1',
    turnId: 'turn-1',
    stage,
    kind: 'plan_review',
    askedAt: null,
  }
}

function seed(items: AttentionItem[], activeId: string | null = null) {
  useConversationStore.setState({
    conversations: items.map(
      (i) => ({ id: i.conversationId, title: `Title ${i.conversationId}` }) as ConversationInfoResponse,
    ),
    activeId,
    attention: Object.fromEntries(items.map((i) => [i.approvalId, i])),
    attentionOrder: items.map((i) => i.approvalId),
    stackIgnored: {},
  })
}

/** The approval ids on screen, front first. */
function shownIds(): string[] {
  return [...document.querySelectorAll('[data-slot="approval-notification"]')].map(
    (el) => el.getAttribute('data-approval-id') ?? '',
  )
}

function card(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-slot="approval-notification"][data-approval-id="${id}"]`)
  if (!el) throw new Error(`no notification for ${id}`)
  return el
}

beforeEach(() => {
  mocks.approve.mockReset().mockResolvedValue(undefined)
  mocks.deny.mockReset().mockResolvedValue(undefined)
  usePlanReviewStore.setState({ activeReviewId: null })
})

describe('approval notifications', () => {
  it('draws the front of the queue in its order, inside a labelled region', () => {
    seed([approval('a', 'c1'), approval('b', 'c2'), approval('c', 'c3'), approval('d', 'c4')])
    render(<ApprovalNotifications onSelect={async () => true} />)
    expect(screen.getByRole('region', { name: i18n.t('notifications.region') })).toBeInTheDocument()
    expect(shownIds()).toEqual(['a', 'b', 'c'])
  })

  it('leaves out the conversation being read', () => {
    seed([approval('a', 'being-read'), approval('b', 'elsewhere')], 'being-read')
    render(<ApprovalNotifications onSelect={async () => true} />)
    expect(shownIds()).toEqual(['b'])
  })

  it('offers the conversation being read when its transcript is inert', () => {
    seed([approval('a', 'being-read'), approval('b', 'elsewhere')], 'being-read')
    render(<ApprovalNotifications onSelect={async () => true} transcriptInert />)
    expect(shownIds()).toEqual(['a', 'b'])
  })

  /** A full stack deferring its front shows the same three ids in a new
   *  order — the case a membership diff could not see. */
  it('moves a deferred question to the back and brings the next one forward', async () => {
    seed([approval('a', 'c1'), approval('b', 'c2'), approval('c', 'c3'), approval('d', 'c4')])
    render(<ApprovalNotifications onSelect={async () => true} />)
    await userEvent.click(within(card('a')).getByRole('button', { name: i18n.t('chat.approvalNotification.defer') }))
    expect(useConversationStore.getState().attentionOrder).toEqual(['b', 'c', 'd', 'a'])
    await waitFor(() => expect(shownIds()).toEqual(['b', 'c', 'd']))
  })

  it('offers the named actions and an "ignore" close button, never the registry default label', () => {
    seed([approval('a', 'c1')])
    render(<ApprovalNotifications onSelect={async () => true} />)
    const buttons = within(card('a')).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      i18n.t('chat.approvalNotification.defer'),
      i18n.t('chat.approvalNotification.view'),
      i18n.t('chat.tool.deny'),
      i18n.t('chat.tool.allow'),
      '',
    ])
    expect(within(card('a')).getByRole('button', { name: i18n.t('chat.approvalNotification.ignore') })).toBeTruthy()
    expect(within(card('a')).queryByRole('button', { name: 'Dismiss notification' })).toBeNull()
  })

  /** Ignoring is not answering and not deferring: the question stays owed,
   *  so it stays in the inbox, and it leaves the stack for good. */
  it('takes an ignored question off the stack only, and keeps it in the inbox', async () => {
    seed([approval('a', 'c1'), approval('b', 'c2'), approval('c', 'c3'), approval('d', 'c4')])
    render(
      <>
        <NotificationInbox onSelect={async () => true} transcriptInert={false} />
        <ApprovalNotifications onSelect={async () => true} />
      </>,
    )
    await userEvent.click(within(card('a')).getByRole('button', { name: i18n.t('chat.approvalNotification.ignore') }))
    await waitFor(() => expect(shownIds()).toEqual(['b', 'c', 'd']))
    const state = useConversationStore.getState()
    expect(state.attentionOrder).toEqual(['a', 'b', 'c', 'd'])
    expect(state.attention.a).toBeDefined()
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(mocks.deny).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^Waiting on you/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText('Title c1').length).toBeGreaterThan(0)
  })

  it('forgets the ignore once the question is answered', async () => {
    seed([approval('a', 'c1'), approval('b', 'c2')])
    render(<ApprovalNotifications onSelect={async () => true} />)
    await userEvent.click(within(card('a')).getByRole('button', { name: i18n.t('chat.approvalNotification.ignore') }))
    await waitFor(() => expect(useConversationStore.getState().stackIgnored).toEqual({ a: true }))
    act(() => useConversationStore.getState().retireAnsweredApproval('a'))
    expect(useConversationStore.getState().stackIgnored).toEqual({})
    expect(shownIds()).toEqual(['b'])
  })

  it('retires an answered question from the queue', async () => {
    seed([approval('a', 'c1'), approval('b', 'c2')])
    render(<ApprovalNotifications onSelect={async () => true} />)
    await userEvent.click(within(card('a')).getByRole('button', { name: i18n.t('chat.tool.allow') }))
    expect(mocks.approve).toHaveBeenCalledWith('a')
    expect(useConversationStore.getState().attentionOrder).toEqual(['b'])
    await waitFor(() => expect(shownIds()).toEqual(['b']))
  })

  it('marks the question orphaned when the backend refuses the answer', async () => {
    const markApprovalOrphaned = vi.fn()
    seed([approval('a', 'c1')])
    useConversationStore.setState({ markApprovalOrphaned })
    mocks.deny.mockRejectedValue(new Error('turn gone'))
    render(<ApprovalNotifications onSelect={async () => true} />)
    await userEvent.click(within(card('a')).getByRole('button', { name: i18n.t('chat.tool.deny') }))
    expect(mocks.deny).toHaveBeenCalledWith({ approvalId: 'a', reason: null })
    await waitFor(() => expect(markApprovalOrphaned).toHaveBeenCalledWith('a'))
  })

  it('opens the conversation and defers the question when viewed', async () => {
    const onSelect = vi.fn().mockResolvedValue(true)
    seed([approval('a', 'c1'), approval('b', 'c2')])
    render(<ApprovalNotifications onSelect={onSelect} />)
    await userEvent.click(within(card('a')).getByRole('button', { name: i18n.t('chat.approvalNotification.view') }))
    expect(onSelect).toHaveBeenCalledWith('c1')
    expect(useConversationStore.getState().attentionOrder).toEqual(['b', 'a'])
  })

  /** A decision cannot rest on something the reader did not see. */
  it('shows a path in full and lets the read be decided here', () => {
    const path = 'C:/work/repo/src/components/layout/approval-queue.ts'
    seed([approval('a', 'c1', path)])
    render(<ApprovalNotifications onSelect={async () => true} />)
    const arg = card('a').querySelector('[data-slot="tool-arg"]')
    expect(arg?.textContent).toContain('approval-queue.ts')
    expect(arg?.className).not.toMatch(/line-clamp/)
    expect(within(card('a')).getByRole('button', { name: i18n.t('chat.tool.allow') })).toBeInTheDocument()
  })

  it('withholds the decision on a path too long to show in full', () => {
    const path = `src/${'x'.repeat(INLINE_DECISION_LIMIT.chars)}.ts`
    seed([approval('a', 'c1', path)])
    render(<ApprovalNotifications onSelect={async () => true} />)
    expect(within(card('a')).queryByRole('button', { name: i18n.t('chat.tool.allow') })).toBeNull()
    expect(within(card('a')).queryByRole('button', { name: i18n.t('chat.tool.deny') })).toBeNull()
    expect(within(card('a')).getByText(i18n.t('chat.approvalNotification.argumentsTooLong'))).toBeInTheDocument()
    expect(
      within(card('a')).getByRole('button', { name: i18n.t('chat.approvalNotification.view') }),
    ).toBeInTheDocument()
  })

  it('withholds the decision on a description with too many lines', () => {
    const description = Array.from({ length: INLINE_DECISION_LIMIT.lines + 1 }, (_, i) => `line ${i}`).join('\n')
    seed([call('a', 'c1', 'read_file', { path: 'src/a.ts', description })])
    render(<ApprovalNotifications onSelect={async () => true} />)
    expect(within(card('a')).queryByRole('button', { name: i18n.t('chat.tool.allow') })).toBeNull()
    expect(within(card('a')).getByText(i18n.t('chat.approvalNotification.argumentsTooLong'))).toBeInTheDocument()
  })

  it('replaces queued plan copy with the recovery prompt when delivery needs attention', async () => {
    seed([reviewAttention('delivery_queued')])
    useConversationStore.setState({
      conversations: [{ id: 'conversation-1', title: 'Plan conversation' } as ConversationInfoResponse],
    })
    render(<ApprovalNotifications onSelect={async () => true} />)
    expect(await screen.findByText(i18n.t('planReview.deliveryQueued'))).toBeInTheDocument()

    act(() => {
      useConversationStore.setState({ attention: { 'review-1': reviewAttention('delivery_attention') } })
    })

    expect(await screen.findByText(i18n.t('chat.plan.continuationNeedsAttention'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('planReview.deliveryQueued'))).toBeNull()
  })
})

/**
 * "Risky means read it in context": Allow/Deny is offered in a row only for a
 * tool on `READ_ONLY_TOOLS` whose every argument the row draws. Anything with a
 * side effect is a way into its card however little it carries; a read that
 * carries something the row does not draw is too. One case per category.
 */
describe('under a modal overlay', () => {
  function WithModal() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <ApprovalNotifications onSelect={async () => true} />
        <ModalOverlay isOpen={open} onOpenChange={setOpen}>
          <Modal>
            <Dialog aria-label="modal">
              <button type="button" onClick={() => setOpen(false)}>
                close modal
              </button>
            </Dialog>
          </Modal>
        </ModalOverlay>
      </>
    )
  }

  function region(): HTMLElement {
    const el = document.querySelector<HTMLElement>('[data-slot="approval-notifications"]')
    if (!el) throw new Error('no notification region')
    return el
  }

  /** React Aria shuts every sibling of a modal out; a stack drawn above the
   *  dialog would look pressable and be unreachable. */
  it('is not drawn while a modal has shut it out, and comes back when it closes', async () => {
    seed([approval('a', 'c1')])
    render(<WithModal />)
    await waitFor(() => expect(region()).toHaveAttribute('data-under-modal'))
    expect(region()).toHaveClass('hidden')
    await userEvent.click(screen.getByRole('button', { name: 'close modal' }))
    await waitFor(() => expect(region()).not.toHaveAttribute('data-under-modal'))
    expect(region()).not.toHaveClass('hidden')
    expect(shownIds()).toEqual(['a'])
  })

  it('stays drawn beside a non-modal popover', async () => {
    function WithPopover() {
      const trigger = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button type="button" ref={trigger}>
            anchor
          </button>
          <ApprovalNotifications onSelect={async () => true} />
          <Popover isNonModal isOpen triggerRef={trigger}>
            <div>floating</div>
          </Popover>
        </>
      )
    }
    seed([approval('a', 'c1')])
    render(<WithPopover />)
    await screen.findByText('floating')
    expect(region()).not.toHaveAttribute('data-under-modal')
    expect(region()).not.toHaveClass('hidden')
  })
})

describe('which calls may be decided from a row', () => {
  const allow = () => i18n.t('chat.tool.allow')
  const deny = () => i18n.t('chat.tool.deny')
  const note = {
    risky: 'chat.approvalNotification.reviewRequired',
    hidden: 'chat.approvalNotification.contentHidden',
  } as const

  function expectViewOnly(item: AttentionItem, why: keyof typeof note) {
    seed([item])
    render(<ApprovalNotifications onSelect={async () => true} />)
    const el = card(item.approvalId)
    expect(within(el).queryByRole('button', { name: allow() })).toBeNull()
    expect(within(el).queryByRole('button', { name: deny() })).toBeNull()
    expect(
      within(el)
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label') !== i18n.t('chat.approvalNotification.ignore'))
        .map((b) => b.textContent),
    ).toEqual([i18n.t('chat.approvalNotification.defer'), i18n.t('chat.approvalNotification.view')])
    expect(within(el).getByText(i18n.t(note[why]))).toBeInTheDocument()
  }

  function expectDecidable(item: AttentionItem) {
    seed([item])
    render(<ApprovalNotifications onSelect={async () => true} />)
    const el = card(item.approvalId)
    expect(within(el).getByRole('button', { name: allow() })).toBeInTheDocument()
    expect(within(el).getByRole('button', { name: deny() })).toBeInTheDocument()
    expect(el.querySelector('[data-slot="approval-notification-review-required"]')).toBeNull()
    expect(el.querySelector('[data-slot="approval-notification-content-hidden"]')).toBeNull()
  }

  function scopeShown(id: string): string[] {
    return [...card(id).querySelectorAll('[data-slot="approval-notification-scope-arg"]')].map(
      (el) => el.textContent ?? '',
    )
  }

  describe('side effects are always a way in, however short', () => {
    it('run_command with only its command and a description', () => {
      expectViewOnly(call('rc', 'c1', 'run_command', { command: 'ls', description: 'List files' }), 'risky')
      expect(card('rc').querySelector('[data-slot="tool-arg"]')?.textContent).toBe('ls')
    })

    it('Claude Code Bash', () => {
      expectViewOnly(call('b', 'c1', 'Bash', { command: 'ls' }), 'risky')
    })

    it('Bash asking to leave the sandbox', () => {
      expectViewOnly(call('bs', 'c1', 'Bash', { command: 'ls', dangerouslyDisableSandbox: true }), 'risky')
    })

    it('SlashCommand', () => {
      expectViewOnly(call('sc', 'c1', 'SlashCommand', { command: '/compact' }), 'risky')
    })

    it('write_file', () => {
      expectViewOnly(call('w', 'c1', 'write_file', { path: 'src/a.ts', content: 'export {}' }), 'risky')
      expect(card('w').querySelector('[data-slot="tool-arg"]')?.textContent).toContain('src/a.ts')
    })

    it('edit_file', () => {
      expectViewOnly(call('e', 'c1', 'edit_file', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }), 'risky')
    })

    it('Claude Code Write', () => {
      expectViewOnly(call('cw', 'c1', 'Write', { file_path: 'src/a.ts', content: 'x' }), 'risky')
    })

    it('apply_patch', () => {
      expectViewOnly(call('p', 'c1', 'apply_patch', { patch: '*** Begin Patch\n*** Update File: a.ts\n' }), 'risky')
    })

    it('move_file', () => {
      expectViewOnly(call('mv', 'c1', 'move_file', { from: 'a', to: 'b' }), 'risky')
    })

    it('delete_file', () => {
      expectViewOnly(call('rm', 'c1', 'delete_file', { path: 'a' }), 'risky')
    })

    it('a network request', () => {
      expectViewOnly(call('wf', 'c1', 'WebFetch', { url: 'https://example.com' }), 'risky')
    })

    it('an MCP tool', () => {
      expectViewOnly(call('m', 'c1', 'mcp__github__create_issue', { title: 'x', body: 'y' }), 'risky')
    })

    it('a custom tool with no arguments at all', () => {
      expectViewOnly(call('k', 'c1', 'deploy_prod', {}), 'risky')
    })

    it('a QQ write', () => {
      expectViewOnly(call('qq', 'c1', 'qq_set_group_ban', { group_id: 1, user_id: 2, duration: 600 }), 'risky')
    })

    /** A read that already ran into the sandbox and is asking to run outside it. */
    it('a read-only tool retried outside the sandbox', () => {
      expectViewOnly(
        { ...call('re', 'c1', 'read_file', { path: 'src/a.ts' }), retryReason: 'Access is denied.' },
        'risky',
      )
    })
  })

  describe('a read is decided here when the row shows all of it', () => {
    it('read_file with only a path', () => {
      expectDecidable(call('r', 'c1', 'read_file', { path: 'C:/secrets.txt' }))
    })

    it('list_directory', () => {
      expectDecidable(call('ld', 'c1', 'list_directory', { path: 'C:/Users' }))
    })

    it('search_files draws its required directory beside the pattern', () => {
      expectDecidable(call('s', 'c1', 'search_files', { pattern: 'TODO', path: 'C:/Users', max_results: 20 }))
      expect(scopeShown('s')).toEqual(['path C:/Users', 'max_results 20'])
    })

    it('glob with its directory', () => {
      expectDecidable(call('g', 'c1', 'glob', { pattern: '**/*.ts', path: 'src' }))
      expect(scopeShown('g')).toEqual(['path src'])
    })

    it('Claude Code Read with an offset and a limit', () => {
      expectDecidable(call('cr', 'c1', 'Read', { file_path: 'src/a.ts', offset: 10, limit: 40 }))
      expect(scopeShown('cr')).toEqual(['offset 10', 'limit 40'])
    })

    it('Claude Code Grep with its filters', () => {
      expectDecidable(call('gr', 'c1', 'Grep', { pattern: 'TODO', path: 'src', glob: '*.ts', '-i': true }))
      expect(scopeShown('gr')).toEqual(['path src', 'glob *.ts', '-i true'])
    })

    it('Claude Code Glob with its directory', () => {
      expectDecidable(call('cg', 'c1', 'Glob', { pattern: '*.md', path: 'docs' }))
    })
  })

  describe('a read with something the row does not draw is a way in', () => {
    it('an argument outside its scope list', () => {
      expectViewOnly(call('rx', 'c1', 'read_file', { path: 'src/a.ts', encoding: 'latin1' }), 'hidden')
    })

    it('a scope argument that is not a scalar', () => {
      expectViewOnly(call('gx', 'c1', 'Grep', { pattern: 'TODO', path: ['a', 'b'] }), 'hidden')
    })

    it('arguments that do not parse', () => {
      expectViewOnly(call('x', 'c1', 'read_file', '{not json'), 'hidden')
    })
  })

  it('a question is offered as a way in, with no withheld-content note', () => {
    seed([call('q', 'c1', 'ask_user', { questions: [] }, 'ask')])
    render(<ApprovalNotifications onSelect={async () => true} />)
    expect(
      within(card('q'))
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label') !== i18n.t('chat.approvalNotification.ignore'))
        .map((b) => b.textContent),
    ).toEqual([i18n.t('chat.approvalNotification.defer'), i18n.t('chat.approvalNotification.answer')])
    expect(within(card('q')).queryByText(i18n.t('chat.approvalNotification.contentHidden'))).toBeNull()
    expect(within(card('q')).queryByText(i18n.t('chat.approvalNotification.reviewRequired'))).toBeNull()
  })
})

describe('viewing a plan review', () => {
  it('opens the review only after the navigation that would close it has finished', async () => {
    seed([reviewAttention('review')])
    let finish: (navigated: boolean) => void = () => {}
    // What the shell's navigation does: asynchronously (settings asks about
    // unsaved work), and ending by closing whatever review was open.
    const onSelect = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = (navigated) => {
            if (navigated) usePlanReviewStore.getState().closeReview()
            resolve(navigated)
          }
        }),
    )
    render(<ApprovalNotifications onSelect={onSelect} transcriptInert />)

    await userEvent.click(screen.getByRole('button', { name: i18n.t('chat.plan.review') }))
    expect(onSelect).toHaveBeenCalledWith('conversation-1')
    await act(async () => finish(true))
    expect(usePlanReviewStore.getState().activeReviewId).toBe('review-1')
  })

  it('does not open the review when leaving was refused', async () => {
    seed([reviewAttention('review')])
    render(<ApprovalNotifications onSelect={async () => false} transcriptInert />)

    await userEvent.click(screen.getByRole('button', { name: i18n.t('chat.plan.review') }))
    await act(async () => {})
    expect(usePlanReviewStore.getState().activeReviewId).toBeNull()
  })
})
