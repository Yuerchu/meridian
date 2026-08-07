import { render, screen } from '@testing-library/react'
import { ToolCallBlock } from './tool-call-block'
import { expectExpanded } from '@/test/disclosure'
import i18n from '@/i18n'
import type { ToolCallDisplay } from '@/types'

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
