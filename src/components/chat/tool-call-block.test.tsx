import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolCallBlock } from './tool-call-block'
import { ChatToolPresentationProvider } from '@/components/ui/chat-tool'
import { expectCollapsed, expectExpanded } from '@/test/disclosure'
import i18n from '@/i18n'
import { api } from '@/api'
import { useConversationStore } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
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

function toolCall(toolName: string, args: unknown, status: ToolCallDisplay['status'] = 'pending'): ToolCallDisplay {
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
 *  The visibility check is not decoration: the card is a `Disclosure`, which
 *  renders its panel collapsed or not, so a diff pulled straight out of
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
    expect(screen.getAllByText('__init__.py')[0]).toBeVisible()
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
    expect(screen.getAllByText('lib.rs')[0]).toBeVisible()
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
    expect(screen.getAllByText('app.py')[0]).toBeVisible()
    expect(screen.getByText(/line_b/)).toBeVisible()
    expect(screen.getByText(/line_B/)).toBeVisible()
    // Unchanged lines appear once as context, not duplicated as -/+ pairs.
    expect(screen.getAllByText(/line_a/)).toHaveLength(1)
    expect(screen.getAllByText(/line_c/)).toHaveLength(1)
  })

  it('renders write_file content with the file name header', () => {
    const { container } = render(
      <ToolCallBlock data={toolCall('write_file', { path: 'notes/todo.md', content: '# Todo\n- item one\n' })} />,
    )

    expectCardOpen(container)
    expect(screen.getAllByText('todo.md')[0]).toBeVisible()
    expect(diffText(container)).toContain('# Todo')
    expect(diffText(container)).toContain('- item one')
    expect(screen.getByText('+2')).toBeVisible()
  })

  /**
   * A hosted Claude Code `Edit` carries exactly `edit_file`'s arguments and a
   * `Write` carries `write_file`'s under `file_path`, so both draw the same
   * diff. Left out of `toolFileDiffs`, the card fell back to the raw argument
   * list — `old_string` and `new_string` laid out as two text blocks, which is
   * the one thing an approval card for an edit must not do.
   */
  it.each([
    ['edit_file', { file_path: 'src/app.py', old_string: 'line_a\nline_b', new_string: 'line_a\nline_B' }],
    ['Edit', { file_path: 'src/app.py', old_string: 'line_a\nline_b', new_string: 'line_a\nline_B' }],
  ])('draws %s as a diff and not as an argument list', (name, args) => {
    const { container } = render(<ToolCallBlock data={toolCall(name, args)} />)

    expectCardOpen(container)
    expect(diffText(container)).toContain('line_b')
    expect(diffText(container)).toContain('line_B')
    expect(container.querySelector('[data-slot="tool-args-list"]')).toBeNull()
  })

  it.each([
    ['write_file', { path: 'notes/todo.md', content: '# Todo\n- item one\n' }],
    ['Write', { file_path: 'notes/todo.md', content: '# Todo\n- item one\n' }],
  ])('draws %s as a diff and not as an argument list', (name, args) => {
    const { container } = render(<ToolCallBlock data={toolCall(name, args)} />)

    expectCardOpen(container)
    expect(screen.getAllByText('todo.md')[0]).toBeVisible()
    expect(diffText(container)).toContain('- item one')
    expect(container.querySelector('[data-slot="tool-args-list"]')).toBeNull()
  })

  /**
   * What the agent reported wins over what the arguments imply. A hosted
   * `Write` over an existing file says, from the arguments, that every line
   * was added; the agent's hunk carries the line it replaced and where.
   */
  it('draws the agent-reported diff over the argument-derived one, numbered from its hunk', () => {
    const data = {
      ...toolCall('Write', { file_path: 'src/lib.rs', content: 'line1\nNEW line2\nline3' }, 'completed'),
      diffs: [
        { path: 'src/lib.rs', old_text: 'line1\nold line2\nline3', new_text: 'line1\nNEW line2\nline3', line: 1 },
      ],
    }
    const { container } = render(<ToolCallBlock data={data} />)
    fireEvent.click(container.querySelector('[data-slot="chat-tool-trigger"]')!)

    const text = diffText(container)
    expect(text).toContain('old line2')
    expect(text).toContain('NEW line2')
    expect(screen.getByText('-1')).toBeVisible()
    // Numbered from the hunk's own line rather than from 1-as-a-whole-file.
    const numbered = container.querySelector('[data-slot="file-diff-line"][data-kind="remove"]')
    expect(numbered?.textContent).toContain('2')
  })

  it('keeps a large file diff bounded until the user asks for every line', async () => {
    const content = Array.from({ length: 320 }, (_, index) => `line-${index}`).join('\n')
    const { container } = render(<ToolCallBlock data={toolCall('write_file', { path: 'notes/large.txt', content })} />)

    expect(container.querySelectorAll('[data-slot="file-diff-line"]')).toHaveLength(300)
    await userEvent.click(screen.getByRole('link', { name: 'Show all lines' }))
    expect(container.querySelectorAll('[data-slot="file-diff-line"]')).toHaveLength(320)
    expect(screen.getByRole('link', { name: 'Show fewer lines' })).toBeVisible()
  })

  it('shows an unrecognized patch format as plain text with real newlines', () => {
    const { container } = render(
      <ToolCallBlock data={toolCall('apply_patch', { patch: 'not a real patch\nsecond line' })} />,
    )

    expectCardOpen(container)
    expect(screen.getByText('not a real patch', { exact: false })).toBeVisible()
    expect(screen.getByText('second line', { exact: false })).toBeVisible()
  })

  /// Mid-stream the JSON is unfinished. What has arrived is read as the fields
  /// it already has — never shown as the raw fragment of JSON it is.
  it('reads the arguments that have arrived while the JSON is still streaming', () => {
    const partial = '{"path": "a.txt", "content": "line one\\nline tw'
    const { container } = render(<ToolCallBlock data={toolCall('write_file', partial)} />)

    expectCardOpen(container)
    expect(container.textContent).not.toContain('{"path"')
    expect(screen.getAllByText('a.txt', { exact: false }).length).toBeGreaterThan(0)
    // Drawn as the diff it already describes; the highlighter splits lines
    // into token spans, so this reads the text rather than one element.
    expect(container.querySelector('[data-slot="file-diff"]')).not.toBeNull()
    expect(container.textContent).toContain('line tw')
  })
})

describe('durable plan review transcript entry', () => {
  it('opens the linked review without rendering the full plan in the transcript', async () => {
    usePlanReviewStore.setState({
      activeReviewId: null,
      summaries: {
        'review-1': {
          review_id: 'review-1',
          conversation_id: 'conversation-1',
          document_id: 'document-1',
          revision_id: 'revision-1',
          assistant_message_id: 'message-1',
          provider_call_id: 'call-1',
          turn_id: 'turn-1',
          status: 'pending',
          delivery_state: null,
          lock_version: 0,
        },
      },
    })
    const data: ToolCallDisplay = {
      call_id: 'call-1',
      tool_name: 'exit_plan',
      arguments: JSON.stringify({ plan: '# A very long plan body' }),
      status: 'pending',
      plan_review_id: 'review-1',
    }

    const { container } = render(<ToolCallBlock data={data} />)
    expect(container.querySelector('[data-slot="plan-review-entry"]')).not.toBeNull()
    expect(container.textContent).not.toContain('A very long plan body')
    await userEvent.click(screen.getByRole('button', { name: 'Review plan' }))
    expect(usePlanReviewStore.getState().activeReviewId).toBe('review-1')
  })
})

describe('large tool results', () => {
  it('provides a keyboard-accessible route to the complete command output', async () => {
    const tail = 'COMPLETE-OUTPUT-TAIL'
    const data = {
      ...toolCall('run_command', { command: 'long-command' }, 'completed'),
      result: `start\n${'x'.repeat(2100)}\n${tail}`,
    }
    const { container } = render(<ToolCallBlock data={data} />)
    const trigger = container.querySelector('[data-slot="chat-tool-trigger"]')!
    await userEvent.click(trigger)

    expect(container.textContent).not.toContain(tail)
    await userEvent.click(screen.getByRole('button', { name: 'Show full result' }))
    expect(container.textContent).toContain(tail)
    expect(screen.getByRole('button', { name: 'Show less' })).toBeVisible()
  })

  /// It opens content in place, so it is a button and has to answer a button's
  /// keys. It was a React Aria `Link` with `onPress` and no `href`, which renders
  /// `<span role="link">`: measured, that answers Enter and ignores Space, so a
  /// keyboard user pressing Space scrolled the page instead of expanding.
  it('answers both Enter and Space, the way a button must', async () => {
    const tail = 'COMPLETE-OUTPUT-TAIL'
    const data = {
      ...toolCall('run_command', { command: 'long-command' }, 'completed'),
      result: `start\n${'x'.repeat(2100)}\n${tail}`,
    }
    const { container } = render(<ToolCallBlock data={data} />)
    await userEvent.click(container.querySelector('[data-slot="chat-tool-trigger"]')!)

    const toggle = screen.getByRole('button', { name: 'Show full result' })
    expect(screen.queryByRole('link', { name: /Show/ })).toBeNull()

    toggle.focus()
    await userEvent.keyboard(' ')
    expect(container.textContent).toContain(tail)

    await userEvent.keyboard('{Enter}')
    expect(container.textContent).not.toContain(tail)
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
      const on = container.querySelector(`[data-slot="${slot}"]`)!.className.includes('ring-status-info')
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
      expect(container.querySelectorAll('.animate-spin, [data-slot="spinner"]')).toHaveLength(0)
    },
  )

  /// Only the one that has not started. Correcting a call that already has an
  /// outcome would rewrite history, and correcting the one being asked about
  /// would take its buttons away.
  it('leaves anything but a running call as it was', () => {
    for (const status of ['pending', 'completed', 'denied', 'error', 'orphaned'] as const) {
      const { unmount } = render(<ToolCallBlock data={toolCall('run_command', { command: 'ls' }, status)} queued />)
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

    rerender(<ToolCallBlock data={{ ...first, approval_id: 'appr-2', retry_reason: 'sandbox denied' }} />)

    expect(screen.getByText(i18n.t('chat.tool.sandboxRetryPrompt'))).toBeVisible()
    // Its own label, not "Allow": what is being agreed to is not the call the
    // user already agreed to.
    expect(screen.getByRole('button', { name: i18n.t('chat.tool.retryWithoutSandbox') })).toBeVisible()
  })

  /// Two spinners side by side read as two things happening at once.
  it('does not spin twice over one running question', () => {
    const { container } = render(
      <ToolCallBlock data={toolCall('ask_user', { questions: [{ id: 'q', question: 'Q?' }] }, 'running')} />,
    )
    expect(container.querySelectorAll('.animate-spin, [data-slot="spinner"]')).toHaveLength(1)
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
    ...toolCall('web_search', { query: 'example' }, 'completed'),
    result: JSON.stringify({
      sources: [
        {
          url: 'https://example.com/docs',
          title: 'Example documentation',
          site_name: 'Example',
          favicon: 'https://example.com/f.ico',
        },
        { url: 'https://react.dev', title: 'React', site_name: '', favicon: null },
      ],
    }),
  })

  it('lists the sources behind a count', async () => {
    render(<ToolCallBlock data={withSources()} />)
    // `ChatSources` is a `Disclosure`, so the list is in the DOM either
    // way — see `@/test/disclosure` for why presence cannot answer this.
    const trigger = screen.getByRole('button', {
      name: i18n.t('chat.tool.webSearch.sources', { count: 2 }),
    })
    expectCollapsed(trigger)

    await userEvent.click(trigger)
    expectExpanded(trigger)
    expect(screen.getByText('Example')).toBeInTheDocument()
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

    const link = screen.getByText('Example').closest('a')!
    expect(link).toHaveAttribute('href', '#meridian-external')
    expect(link).not.toHaveAttribute('target')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(link, event)
    expect(event.defaultPrevented).toBe(true)
    expect(shellOpen).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('routes a middle-click through the native opener too', async () => {
    render(<ToolCallBlock data={withSources()} />)
    await userEvent.click(screen.getByRole('button', { name: i18n.t('chat.tool.webSearch.sources', { count: 2 }) }))

    const link = screen.getByText('Example').closest('a')!
    const event = new MouseEvent('auxclick', { bubbles: true, button: 1, cancelable: true })
    fireEvent(link, event)
    expect(event.defaultPrevented).toBe(true)
    expect(shellOpen).toHaveBeenCalledWith('https://example.com/docs')
  })
})

/**
 * The two lines beside the tool's name. Together they are the whole of what a
 * collapsed card says, so a tool neither has an answer for is a column of
 * identical cards.
 */
describe('the summary lines beside the tool name', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  function summary(container: HTMLElement): string | null {
    return container.querySelector('[data-slot="tool-arg"]')?.textContent ?? null
  }

  function subtitle(container: HTMLElement): string | null {
    return container.querySelector('[data-slot="chat-tool-subtitle"]')?.textContent ?? null
  }

  /**
   * Both, and on separate lines. The description read better as the single
   * summary and quietly took the path off a `write_file` card — whose body
   * renders a diff rather than the raw arguments, with only the file's own name
   * in the header and the directory in a `title` no touch screen can reach.
   * Approving a write is exactly when the directory matters.
   */
  it('shows the description beside the argument it explains, not instead of it', () => {
    const { container } = render(
      <ToolCallBlock
        data={toolCall(
          'Bash',
          { command: 'git log --reverse --diff-filter=A --format=%h', description: 'List migrations by date added' },
          'completed',
        )}
      />,
    )
    expect(summary(container)).toBe('git log --reverse --diff-filter=A --format=%h')
    expect(subtitle(container)).toBe('List migrations by date added')
  })

  /** The case that motivated the two lines: a pending write, whose directory is
   *  the whole of what is being approved. */
  it('keeps the path on a write that also carries a description', () => {
    const { container } = render(
      <ToolCallBlock
        data={toolCall('write_file', {
          path: '/home/me/.ssh/config',
          content: 'Host *',
          description: 'Add the jump host',
        })}
      />,
    )
    expect(summary(container)).toBe('/home/me/.ssh/config')
    expect(subtitle(container)).toBe('Add the jump host')
  })

  it('draws no second line when nothing wrote a description', () => {
    const { container } = render(<ToolCallBlock data={toolCall('Bash', { command: 'ls' }, 'completed')} />)
    expect(subtitle(container)).toBeNull()
  })

  it('falls back to the argument when nothing wrote a description', () => {
    const { container } = render(<ToolCallBlock data={toolCall('Bash', { command: 'pnpm test' }, 'completed')} />)
    expect(summary(container)).toBe('pnpm test')
  })

  /**
   * Claude Code's names arrive through `_meta.claudeCode.toolName`, so a hosted
   * transcript is drawn from the same switch as a native one. Without these
   * every one of these cards said only `Read`, `Glob`, `Grep`.
   */
  it.each([
    ['Read', { file_path: 'src/main.rs' }, 'src/main.rs'],
    ['Edit', { file_path: 'src/lib.rs', old_string: 'a', new_string: 'b' }, 'src/lib.rs'],
    ['Write', { file_path: 'notes.md', content: 'x' }, 'notes.md'],
    ['Glob', { pattern: '**/*.tsx' }, '**/*.tsx'],
    ['Grep', { pattern: 'fn main' }, 'fn main'],
    ['WebFetch', { url: 'https://example.com' }, 'https://example.com'],
  ])('names the file or pattern a hosted %s touched', (name, args, expected) => {
    const { container } = render(<ToolCallBlock data={toolCall(name, args, 'completed')} />)
    expect(summary(container)).toBe(expected)
  })

  /**
   * The bare id, not a guess. Anything from MCP or the custom registry has a
   * schema this cannot know, and `toolLabel` deliberately hands back the key it
   * was given when no translation exists.
   */
  it('says nothing about a tool it has no schema for', () => {
    const { container } = render(
      <ToolCallBlock data={toolCall('mcp__linear__list_issues', { teamId: 'abc' }, 'completed')} />,
    )
    expect(summary(container)).toBeNull()
    expect(screen.getByText('mcp__linear__list_issues')).toBeInTheDocument()
  })

  it('translates a hosted tool rather than showing its bare id', () => {
    render(<ToolCallBlock data={toolCall('Bash', { command: 'ls' }, 'completed')} />)
    expect(screen.getByText(i18n.t('chat.tool.name.Bash'))).toBeInTheDocument()
    expect(screen.queryByText('Bash')).toBeNull()
  })
})

/**
 * The two interactive tools a hosted Claude Code session has, which are this
 * app's own two under different names. Drawn as ordinary tool cards they are
 * both unusable: the plan arrives as a wall of escaped JSON, and the questions
 * as arguments with no way to answer them.
 */
describe('a hosted agent asks with the same cards', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({ attention: {}, attentionOrder: [] })
  })

  function waiting(approvalId: string, args: unknown) {
    useConversationStore.setState({
      attention: {
        [approvalId]: {
          conversationId: 'conv-1',
          approvalId,
          providerCallId: 'call-1',
          messageId: 'msg-1',
          toolName: 'ask_user',
          arguments: JSON.stringify(args),
          kind: 'ask' as const,
        },
      },
      attentionOrder: [approvalId],
    })
  }

  it('draws ExitPlanMode as the plan card and not as its arguments', () => {
    const { container } = render(<ToolCallBlock data={toolCall('ExitPlanMode', { plan: '# Do the thing' })} />)
    expect(container.querySelector('[data-slot="exit-plan"]')).not.toBeNull()
    // The heading is rendered markdown; the raw key never appears.
    expect(screen.getByText('Do the thing')).toBeVisible()
    expect(screen.queryByText(/"plan"/)).toBeNull()
  })

  it('draws AskUserQuestion as the ask form', () => {
    waiting('appr-1', { questions: [{ id: 'question_0', question: 'Which one?', options: [{ label: 'A' }] }] })
    render(<ToolCallBlock data={toolCall('AskUserQuestion', { questions: [{ question: 'Which one?' }] })} />)
    expect(screen.getByText('Which one?')).toBeVisible()
    expect(screen.getByRole('button', { name: i18n.t('chat.tool.askUserSubmit') })).toBeVisible()
  })

  /**
   * The question arrives twice — once as the call the adapter announced, once
   * as the form the approval carried — and only the second has the field ids
   * the agent will read its answers back out of. Answering under the first
   * sends `{"undefined": "A"}`, which parses, reaches the agent, and answers
   * nothing: every question collapses onto one key that matches no field.
   *
   * The id here is deliberately not `question_0`. That is what the index
   * fallback would have produced, so a fixture using it passes whether or not
   * the approval's form is read at all — and an MCP server's schema names its
   * fields whatever it likes.
   */
  it('answers under the ids the approval carried, not the ones the call announced', async () => {
    waiting('appr-1', {
      questions: [{ id: 'scope', question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }],
    })
    render(
      <ToolCallBlock
        data={toolCall('AskUserQuestion', {
          questions: [{ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }],
        })}
      />,
    )

    expect(screen.getByRole('radiogroup', { name: 'Which one?' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Which one?' })).toBeVisible()
    await userEvent.click(screen.getByRole('radio', { name: 'A' }))
    await userEvent.click(screen.getByRole('button', { name: i18n.t('chat.tool.askUserSubmit') }))

    expect(api.respondToAsk).toHaveBeenCalledWith({
      approvalId: 'appr-1',
      response: JSON.stringify({ scope: 'A' }),
    })
  })

  it('keeps the submit name and exposes a busy state while an answer is sending', async () => {
    let finish!: () => void
    vi.mocked(api.respondToAsk).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    waiting('appr-1', {
      questions: [{ id: 'scope', question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }],
    })
    render(<ToolCallBlock data={toolCall('AskUserQuestion', { questions: [] })} />)

    await userEvent.click(screen.getByRole('radio', { name: 'A' }))
    const submit = screen.getByRole('button', { name: i18n.t('chat.tool.askUserSubmit') })
    await userEvent.click(submit)

    expect(submit).toHaveAttribute('aria-disabled', 'true')
    expect(submit.closest('form')).toHaveAttribute('aria-busy', 'true')
    expect(submit.querySelector('[data-slot="spinner"]')).not.toBeNull()
    finish()
  })

  /**
   * A question the asker will not do without cannot be skipped past, and the
   * form will not go until it is answered.
   *
   * The card is the only place this can be enforced. The backend's own check
   * declines the *whole* payload over one missing required answer — upstream
   * validates `content` against the schema and a malformed accept yields empty
   * content, so there is no partial delivery — and by then the card has
   * reported success and retired the queue entry. Every other answer on the
   * form would be gone with nothing said about it.
   */
  it('will not submit a form missing an answer the asker requires', async () => {
    waiting('appr-1', {
      questions: [
        { id: 'branch', question: 'Which branch?', required: true },
        { id: 'note', question: 'Anything else?' },
      ],
    })
    render(<ToolCallBlock data={toolCall('AskUserQuestion', { questions: [] })} />)

    const submit = () => screen.getByRole('button', { name: i18n.t('chat.tool.askUserSubmit') })
    // There is no way past it: the optional question can be skipped, the
    // required one is not offered a skip at all.
    expect(screen.getAllByRole('button', { name: i18n.t('chat.tool.skipQuestion') })).toHaveLength(1)

    // The questions render in order, so the boxes do too.
    const [branch, note] = screen.getAllByRole('textbox')
    await userEvent.type(note, 'be careful')
    expect(submit()).toBeEnabled()
    await userEvent.click(submit())
    expect(await screen.findByText(i18n.t('chat.tool.answerRequired'))).toBeVisible()
    expect(api.respondToAsk).not.toHaveBeenCalled()

    // Answering it releases the form, and the optional answer goes with it
    // rather than being lost to a decline.
    await userEvent.type(branch, 'main')
    await userEvent.click(submit())
    expect(api.respondToAsk).toHaveBeenCalledWith({
      approvalId: 'appr-1',
      response: JSON.stringify({ branch: 'main', note: 'be careful' }),
    })
  })

  /**
   * A required question with options has to be answered *from them*, and the
   * box beside it does not count.
   *
   * That box is a separate property in the schema (the adapter's companion
   * "Other" field), so an accept filling it in is still missing the required
   * one — and a missing required field is not that answer dropped, it is the
   * whole form dropped. Treating typed text as an answer here therefore lets
   * the user past a check that then fails silently on the far side, after the
   * card has said the form was sent.
   */
  it.each([
    ['single-select', false],
    ['multi-select', true],
  ])('holds a required %s question to a selection, not to what was typed beside it', async (_kind, multi) => {
    waiting('appr-1', {
      questions: [
        {
          id: 'scope',
          question: 'Which one?',
          required: true,
          multi_select: multi,
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    })
    render(<ToolCallBlock data={toolCall('AskUserQuestion', { questions: [] })} />)
    const submit = () => screen.getByRole('button', { name: i18n.t('chat.tool.askUserSubmit') })

    await userEvent.type(screen.getByRole('textbox'), 'something else entirely')
    expect(submit()).toBeEnabled()
    await userEvent.click(submit())
    expect(await screen.findByText(i18n.t('chat.tool.answerRequired'))).toBeVisible()
    expect(api.respondToAsk).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole(multi ? 'checkbox' : 'radio', { name: 'A' }))
    await userEvent.click(submit())
    // One string for two actions, which is what `formatAnswer` sends. That it
    // is *accepted* rather than declined is the other half of this and cannot
    // be asserted here — `elicitation.rs` takes it apart into the two
    // properties the schema has, under
    // `a_required_question_answered_with_a_note_beside_it_is_still_accepted`.
    expect(api.respondToAsk).toHaveBeenCalledWith({
      approvalId: 'appr-1',
      response: JSON.stringify({ scope: 'A\n\nNotes: something else entirely' }),
    })
  })

  /**
   * And where nothing could carry typed text, there is no box to type into. A
   * question whose answer must be one of its `const`s and which has no
   * companion field behind it cannot send free text at all — and the text would
   * not merely go nowhere, since `formatAnswer` folds a note into the selection
   * it sits beside, turning a valid choice into an unplaceable string.
   */
  it('offers no free-text box for a question that cannot carry one', () => {
    waiting('appr-1', {
      questions: [
        { id: 'choice', question: 'Which one?', accepts_text: false, options: [{ label: 'A' }, { label: 'B' }] },
      ],
    })
    render(<ToolCallBlock data={toolCall('AskUserQuestion', { questions: [] })} />)
    expect(screen.getByRole('radio', { name: 'A' })).toBeVisible()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  /**
   * And the form does not swap back the moment it is answered. Sending retires
   * the queue entry it was read from, so a component reading the store live
   * would re-render from the call's own input — losing every selection while
   * the card is still on screen waiting for the result.
   */
  it('keeps the form it was rendered from after the answer retires the queue entry', async () => {
    waiting('appr-1', {
      questions: [{ id: 'scope', question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }],
    })
    const data = toolCall('AskUserQuestion', {
      questions: [{ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }],
    })
    const { rerender } = render(<ToolCallBlock data={data} />)

    await userEvent.click(screen.getByRole('radio', { name: 'A' }))
    await userEvent.click(screen.getByRole('button', { name: i18n.t('chat.tool.askUserSubmit') }))

    useConversationStore.setState({ attention: {}, attentionOrder: [] })
    rerender(<ToolCallBlock data={data} />)
    expect(screen.getByText('Which one?')).toBeVisible()
  })
})

describe('as bubble blocks', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    useConversationStore.setState({ activeId: null })
  })

  function inBubble(ui: React.ReactNode) {
    return render(<ChatToolPresentationProvider value="bubble">{ui}</ChatToolPresentationProvider>)
  }

  function keyOf(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('[data-slot="chat-tool-trigger"]')!
  }

  function blockOf(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('[data-slot="chat-tool"]')!
  }

  it('draws a call as one block of the bubble, head and detail together', () => {
    const { container } = inBubble(<ToolCallBlock data={toolCall('Bash', { command: 'ls' }, 'completed')} />)
    const key = keyOf(container)
    const block = blockOf(container)
    expect(block).toHaveAttribute('data-bubble-block')
    expect(block).toContainElement(key)
    const panel = document.getElementById(key.getAttribute('aria-controls')!)!
    expect(block).toContainElement(panel)
    // A finished call keeps its detail shut; the block does not grow a heading.
    expectCollapsed(key)
    expect(container.querySelector('h3')).toBeNull()
  })

  /// The rule the card already lives by, kept on the block: what an approval
  /// rests on is the exact path, and a decision made about a truncated one is
  /// a decision about something the reader could not see.
  it('gives a call waiting on a decision the whole column, path and description both on the head', () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={toolCall('write_file', {
          path: '/home/me/.ssh/config',
          content: 'Host *',
          description: 'Add the jump host',
        })}
      />,
    )
    const key = keyOf(container)
    expect(blockOf(container)).toHaveClass('w-full')
    expect(key.querySelector('[data-slot="tool-arg"]')).toHaveTextContent('/home/me/.ssh/config')
    expect(key.querySelector('[data-slot="chat-tool-subtitle"]')).toHaveTextContent('Add the jump host')
    expectExpanded(key)
    expect(screen.getByText('Allow')).toBeVisible()
    expect(screen.getByText('Deny')).toBeVisible()
  })

  it('keeps an ordinary block as wide as its label, with the description as a tooltip', async () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={toolCall('Bash', { command: 'git log --oneline', description: 'Recent history' }, 'completed')}
      />,
    )
    const key = keyOf(container)
    expect(blockOf(container)).not.toHaveClass('w-full')
    expect(key.querySelector('[data-slot="chat-tool-subtitle"]')).toBeNull()
    // Tooltip, not the browser's: nothing on the key carries `title`.
    expect(container.querySelector('[title]')).toBeNull()
    await userEvent.hover(key)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Recent history')
  })

  it('asks a question from a panel, open while it waits', () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={toolCall('ask_user', {
          questions: [{ id: 'q1', question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }],
        })}
      />,
    )
    const key = keyOf(container)
    expect(key).toHaveTextContent('Question')
    expectExpanded(key)
    const panel = document.getElementById(key.getAttribute('aria-controls')!)!
    expect(within(panel).getByText('Which one?')).toBeVisible()
    expect(within(panel).getByRole('button', { name: /Submit/ })).toBeVisible()
  })

  it('makes the plan review a key that goes to the review', async () => {
    usePlanReviewStore.setState({
      activeReviewId: null,
      summaries: {
        'review-2': {
          review_id: 'review-2',
          conversation_id: 'conversation-1',
          document_id: 'document-1',
          revision_id: 'revision-1',
          assistant_message_id: 'message-1',
          provider_call_id: 'call-1',
          turn_id: 'turn-1',
          status: 'pending',
          delivery_state: null,
          lock_version: 0,
        },
      },
    })
    const { container } = inBubble(
      <ToolCallBlock
        data={{
          call_id: 'call-1',
          tool_name: 'exit_plan',
          arguments: JSON.stringify({ plan: '# A very long plan body' }),
          status: 'pending',
          plan_review_id: 'review-2',
        }}
      />,
    )
    const key = container.querySelector<HTMLElement>('[data-slot="plan-review-entry"]')!
    expect(key).toHaveAttribute('data-state', 'navigate')
    expect(container.textContent).not.toContain('A very long plan body')
    await userEvent.click(key)
    expect(usePlanReviewStore.getState().activeReviewId).toBe('review-2')
  })

  it('unifies a search into one key whatever its state', () => {
    const { container, rerender } = inBubble(
      <ToolCallBlock data={toolCall('web_search', { query: 'weather forecast' }, 'running')} />,
    )
    expect(keyOf(container)).toHaveTextContent('weather forecast')
    expect(keyOf(container)).toHaveAttribute('data-state', 'input-available')
    rerender(
      <ChatToolPresentationProvider value="bubble">
        <ToolCallBlock
          data={{
            ...toolCall('web_search', { query: 'weather forecast' }, 'completed'),
            result: JSON.stringify({ sources: [{ title: 'Docs', url: 'https://example.com/docs', content: '' }] }),
          }}
        />
      </ChatToolPresentationProvider>,
    )
    expect(keyOf(container)).toHaveAttribute('data-state', 'output-available')
    expect(keyOf(container)).toHaveTextContent(/1 source/)
  })
})
