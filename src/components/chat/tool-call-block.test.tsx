import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolCallBlock } from './tool-call-block'
import { expectCollapsed, expectExpanded } from '@/test/disclosure'
import i18n from '@/i18n'
import { api } from '@/api'
import type { ToolCallDisplay } from '@/types'

// The sources open in the user's browser, not in the WebView.
const shellOpen = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }))

// Resolved rather than bare: the cards attach a `.catch` to turn a rejected
// decision into an orphaned card, and `undefined.catch` would throw.
vi.mock('@/api', () => ({
  api: {
    approveToolCall: vi.fn().mockResolvedValue(undefined),
    denyToolCall: vi.fn().mockResolvedValue(undefined),
    respondToAsk: vi.fn().mockResolvedValue(undefined),
  },
}))

function toolCall(
  toolName: string,
  args: unknown,
  status: ToolCallDisplay['status'] = 'pending',
): ToolCallDisplay {
  return {
    call_id: 'call-1',
    tool_name: toolName,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
    status,
    // A pending call without one renders as orphaned — there would be nothing
    // for its buttons to answer. Only pending needs it.
    ...(status === 'pending' ? { approval_id: 'appr-1' } : {}),
  }
}

/** Diff lines are syntax-highlighted, so their text is split across token
 *  spans and `getByText` — which only reads a node's own text children — no
 *  longer sees a whole line. Read the rendered diff as one string instead.
 *
 *  The visibility check is not decoration: the card is a HeroUI `Disclosure`,
 *  which renders its panel collapsed or not, so a diff pulled straight out of
 *  the DOM would read the same either way. */
function diffText(container: HTMLElement): string {
  const lines = Array.from(container.querySelectorAll('[data-slot="file-diff-line"]'))
  expect(lines.length, 'no diff lines rendered').toBeGreaterThan(0)
  for (const line of lines) expect(line).toBeVisible()
  return lines.map((line) => line.textContent).join('\n')
}

/** A pending call opens itself, because it is asking for something. */
function expectCardOpen(container: HTMLElement) {
  expectExpanded(container.querySelector('[data-slot="chat-tool-trigger"]')!)
}

describe('ToolCallBlock file-edit diff rendering', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders a Codex-style apply_patch as a per-file diff card, not raw JSON', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: fastapis/api/v1/volcengine_assets/__init__.py',
      '@@',
      ' async def create_volcengine_asset(',
      '-) -> AssetResponse:',
      '+) -> AssetCreateResponse:',
      '*** End Patch',
    ].join('\n')
    const { container } = render(<ToolCallBlock data={toolCall('apply_patch', { base_path: '.', patch })} />)

    expectCardOpen(container)
    expect(screen.getByText('__init__.py')).toBeVisible()
    expect(diffText(container)).toContain(') -> AssetCreateResponse:')
    expect(diffText(container)).toContain('async def create_volcengine_asset(')
    expect(screen.getByText('+1')).toBeVisible()
    expect(screen.getByText('-1')).toBeVisible()
    // The envelope markers and escaped-JSON dump must not appear.
    expect(container.textContent).not.toContain('*** Begin Patch')
    expect(container.textContent).not.toContain('base_path')
    // Approval buttons still render for pending calls.
    expect(screen.getByText('Allow')).toBeVisible()
  })

  it('renders a unified diff apply_patch with per-file grouping', () => {
    // The hunk header miscounts the lines on purpose (models do this
    // routinely) — the loose parser must still render it.
    const patch = [
      '--- a/src/lib.rs',
      '+++ b/src/lib.rs',
      '@@ -1,3 +1,3 @@',
      ' fn keep() {}',
      '-fn old() {}',
      '+fn new() {}',
    ].join('\n')
    const { container } = render(<ToolCallBlock data={toolCall('apply_patch', { patch })} />)

    expectCardOpen(container)
    expect(screen.getByText('lib.rs')).toBeVisible()
    expect(diffText(container)).toContain('fn new() {}')
    expect(diffText(container)).toContain('fn old() {}')
  })

  it('renders edit_file as a real line diff, keeping common lines as context', () => {
    const { container } = render(
      <ToolCallBlock
        data={toolCall('edit_file', {
          file_path: 'src/app.py',
          old_string: 'line_a\nline_b\nline_c',
          new_string: 'line_a\nline_B\nline_c',
        })}
      />,
    )

    expectCardOpen(container)
    expect(screen.getByText('app.py')).toBeVisible()
    expect(screen.getByText(/line_b/)).toBeVisible()
    expect(screen.getByText(/line_B/)).toBeVisible()
    // Unchanged lines appear once as context, not duplicated as -/+ pairs.
    expect(screen.getAllByText(/line_a/)).toHaveLength(1)
    expect(screen.getAllByText(/line_c/)).toHaveLength(1)
  })

  it('renders write_file content with the file name header', () => {
    const { container } = render(
      <ToolCallBlock
        data={toolCall('write_file', { path: 'notes/todo.md', content: '# Todo\n- item one\n' })}
      />,
    )

    expectCardOpen(container)
    expect(screen.getByText('todo.md')).toBeVisible()
    expect(diffText(container)).toContain('# Todo')
    expect(diffText(container)).toContain('- item one')
    expect(screen.getByText('+2')).toBeVisible()
  })

  it('shows an unrecognized patch format as plain text with real newlines', () => {
    const { container } = render(
      <ToolCallBlock data={toolCall('apply_patch', { patch: 'not a real patch\nsecond line' })} />,
    )

    expectCardOpen(container)
    expect(screen.getByText('not a real patch', { exact: false })).toBeVisible()
    expect(screen.getByText('second line', { exact: false })).toBeVisible()
  })

  it('falls back to raw argument text while the JSON is still streaming', () => {
    // hljs splits the text into token spans, so assert on the args container.
    const partial = '{"path": "a.txt", "cont'
    const { container } = render(<ToolCallBlock data={toolCall('write_file', partial)} />)

    expectCardOpen(container)
    const args = container.querySelector('[data-slot="chat-tool-args"]')
    expect(args).not.toBeNull()
    expect(args!).toBeVisible()
    expect(args!.textContent).toContain(partial)
  })
})

/// The three cards that draw their own body used to handle exactly two states:
/// waiting on the user, and answered. Everything else fell through to a header
/// with nothing under it.
///
/// They meet those states routinely now that a tool row records how its call
/// went — a refusal survives a reload instead of quietly becoming a green tick,
/// and an unanswered call on a live turn reads as running rather than being
/// written off. An empty card would leave the user reading a question with no
/// form, no answer, and no reason given.
describe('the interactive cards say what became of them', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const CARDS = [
    { name: 'ask_user', args: { questions: [{ id: 'q1', question: 'Which one?' }] } },
    { name: 'enter_plan', args: { reason: 'this is a big change' } },
    { name: 'exit_plan', args: { plan: '# Do the thing' } },
  ]
  // Every status that is neither "waiting on the user" nor "answered", which
  // are the two each card draws for itself.
  const UNANSWERED: Array<[ToolCallDisplay['status'], string]> = [
    ['denied', 'chat.tool.wasDenied'],
    ['error', 'chat.tool.wasError'],
    ['orphaned', 'chat.tool.orphaned'],
    ['running', 'chat.tool.running'],
    ['approved', 'chat.tool.running'],
  ]

  for (const card of CARDS) {
    for (const [status, key] of UNANSWERED) {
      it(`${card.name} · ${status}`, () => {
        render(<ToolCallBlock data={toolCall(card.name, card.args, status)} />)
        expect(screen.getByText(i18n.t(key))).toBeVisible()
      })
    }
  }

  /// "Something went wrong" on its own is not much use when the thing that went
  /// wrong said what it was. The general line stays — it is what makes the state
  /// readable at a glance — and the tool's own words go under it.
  it.each(['enter_plan', 'exit_plan'])('%s shows what the tool actually said', (name) => {
    const args = name === 'enter_plan' ? { reason: 'r' } : { plan: '# p' }
    for (const [status, key] of [
      ['error', 'chat.tool.wasError'],
      ['denied', 'chat.tool.wasDenied'],
    ] as const) {
      const { unmount } = render(
        <ToolCallBlock data={{ ...toolCall(name, args, status), result: 'ENOENT: no such file' }} />,
      )
      expect(screen.getByText(i18n.t(key))).toBeVisible()
      expect(screen.getByText('ENOENT: no such file')).toBeVisible()
      unmount()
    }
  })

  /// The ring means "this one is waiting on you". Keyed off "not denied" it was
  /// drawn around an errored call, an abandoned one and an already-approved one
  /// alike — each of them asking for a decision that had been made, or could
  /// not be.
  it.each(['enter_plan', 'exit_plan'])('%s only rings while it is waiting', (name) => {
    const args = name === 'enter_plan' ? { reason: 'r' } : { plan: '# p' }
    const slot = name === 'enter_plan' ? 'enter-plan' : 'exit-plan'
    const ringed = (status: ToolCallDisplay['status']) => {
      const { container, unmount } = render(<ToolCallBlock data={toolCall(name, args, status)} />)
      const on = container.querySelector(`[data-slot="${slot}"]`)!.className.includes('ring-info')
      unmount()
      return on
    }

    expect(ringed('pending')).toBe(true)
    for (const decided of ['completed', 'denied', 'error', 'orphaned', 'running'] as const) {
      expect(ringed(decided), decided).toBe(false)
    }
  })

  /// A call waiting its turn arrives here as `running` — that is what an
  /// unanswered call hydrates as — and gets corrected from its position. The
  /// spinner is the only thing on screen claiming work is happening, so a card
  /// that has not started must not have one.
  it.each(['ask_user', 'enter_plan', 'exit_plan', 'run_command'])(
    '%s says it is waiting its turn rather than spinning',
    (name) => {
      const args = {
        ask_user: { questions: [{ id: 'q', question: 'Q?' }] },
        enter_plan: { reason: 'r' },
        exit_plan: { plan: '# p' },
        run_command: { command: 'ls' },
      }[name]!
      const { container } = render(<ToolCallBlock data={toolCall(name, args, 'running')} queued />)
      expect(screen.getByText(i18n.t('chat.tool.queued'))).toBeVisible()
      expect(container.querySelectorAll('.animate-spin')).toHaveLength(0)
    },
  )

  /// Only the one that has not started. Correcting a call that already has an
  /// outcome would rewrite history, and correcting the one being asked about
  /// would take its buttons away.
  it('leaves anything but a running call as it was', () => {
    for (const status of ['pending', 'completed', 'denied', 'error', 'orphaned'] as const) {
      const { unmount } = render(
        <ToolCallBlock data={toolCall('run_command', { command: 'ls' }, status)} queued />,
      )
      expect(screen.queryByText(i18n.t('chat.tool.queued')), status).toBeNull()
      unmount()
    }
  })

  /// What a sandbox escalation actually walks into: the same card, already
  /// answered once. The card's "sent" state is a spinner, and it is local — so
  /// without a remount the second question arrives behind a card that looks
  /// like it is already working, which is the bug as the user meets it: stuck
  /// on "running", buttons only after reopening the conversation.
  it('offers the sandbox retry on a card the user already answered', async () => {
    const first = toolCall('run_command', { command: 'cargo test' })
    const { rerender } = render(<ToolCallBlock data={first} />)

    await userEvent.click(screen.getByRole('button', { name: i18n.t('chat.tool.allow') }))
    expect(screen.queryByRole('button', { name: i18n.t('chat.tool.allow') })).toBeNull()
    expect(screen.getByText(i18n.t('chat.tool.running'))).toBeVisible()

    rerender(
      <ToolCallBlock
        data={{ ...first, approval_id: 'appr-2', retry_reason: 'sandbox denied' }}
      />,
    )

    expect(screen.getByText(i18n.t('chat.tool.sandboxRetryPrompt'))).toBeVisible()
    // Its own label, not "Allow": what is being agreed to is not the call the
    // user already agreed to.
    expect(
      screen.getByRole('button', { name: i18n.t('chat.tool.retryWithoutSandbox') }),
    ).toBeVisible()
  })

  /// Two spinners side by side read as two things happening at once.
  it('does not spin twice over one running question', () => {
    const { container } = render(
      <ToolCallBlock
        data={toolCall('ask_user', { questions: [{ id: 'q', question: 'Q?' }] }, 'running')}
      />,
    )
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(1)
  })

  it('does not deny a tool while Enter is confirming IME composition', async () => {
    const user = userEvent.setup()
    render(<ToolCallBlock data={toolCall('run_command', { command: 'rm -rf build' })} />)
    await user.click(screen.getByRole('button', { name: i18n.t('chat.tool.deny') }))

    const input = screen.getByPlaceholderText(i18n.t('chat.tool.denyReasonPlaceholder'))
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(api.denyToolCall).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', isComposing: false })
    expect(api.denyToolCall).toHaveBeenCalledTimes(1)
  })

  it('does not send plan feedback while Enter is confirming IME composition', async () => {
    const user = userEvent.setup()
    render(<ToolCallBlock data={toolCall('exit_plan', { plan: '# Plan' })} />)
    await user.click(screen.getByRole('button', { name: i18n.t('chat.plan.revise') }))

    const input = screen.getByPlaceholderText(i18n.t('chat.plan.feedbackPlaceholder'))
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(api.denyToolCall).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', isComposing: false })
    expect(api.denyToolCall).toHaveBeenCalledTimes(1)
  })
})

describe('web search sources', () => {
  const withSources = () => ({
    ...toolCall('web_search', { query: 'heroui' }, 'completed'),
    result: JSON.stringify({
      sources: [
        { url: 'https://heroui.com/docs', title: 'HeroUI documentation', site_name: 'HeroUI', favicon: 'https://heroui.com/f.ico' },
        { url: 'https://react.dev', title: 'React', site_name: '', favicon: null },
      ],
    }),
  })

  it('lists the sources behind a count', async () => {
    render(<ToolCallBlock data={withSources()} />)
    // `ChatSources` is a HeroUI `Disclosure`, so the list is in the DOM either
    // way — see `@/test/disclosure` for why presence cannot answer this.
    const trigger = screen.getByRole('button', {
      name: i18n.t('chat.tool.webSearch.sources', { count: 2 }),
    })
    expectCollapsed(trigger)

    await userEvent.click(trigger)
    expectExpanded(trigger)
    expect(screen.getByText('HeroUI')).toBeInTheDocument()
    // No `site_name`, so the title carries the pill.
    expect(screen.getByText('React')).toBeInTheDocument()
  })

  /**
   * This is a WebView. An anchor left to itself navigates the application to
   * the page — no address bar, no way back — and `target="_blank"` does not
   * save it, because there is no second tab to open into. The click has to be
   * taken and handed to the browser.
   */
  it('opens a source in the browser rather than in the app', async () => {
    render(<ToolCallBlock data={withSources()} />)
    await userEvent.click(screen.getByRole('button', { name: i18n.t('chat.tool.webSearch.sources', { count: 2 }) }))

    const link = screen.getByText('HeroUI').closest('a')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(link, event)
    expect(event.defaultPrevented).toBe(true)
    expect(shellOpen).toHaveBeenCalledWith('https://heroui.com/docs')
  })
})
