import { render, screen } from '@testing-library/react'
import { ToolCallBlock } from './tool-call-block'
import i18n from '@/i18n'
import type { ToolCallDisplay } from '@/types'

vi.mock('@/api', () => ({
  api: {
    approveToolCall: vi.fn(),
    denyToolCall: vi.fn(),
    respondToAsk: vi.fn(),
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
  }
}

/** Diff lines are syntax-highlighted, so their text is split across token
 *  spans and `getByText` — which only reads a node's own text children — no
 *  longer sees a whole line. Read the rendered diff as one string instead. */
function diffText(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('[data-slot="file-diff-line"]'))
    .map((line) => line.textContent)
    .join('\n')
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

    expect(screen.getByText('__init__.py')).toBeInTheDocument()
    expect(diffText(container)).toContain(') -> AssetCreateResponse:')
    expect(diffText(container)).toContain('async def create_volcengine_asset(')
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    // The envelope markers and escaped-JSON dump must not appear.
    expect(container.textContent).not.toContain('*** Begin Patch')
    expect(container.textContent).not.toContain('base_path')
    // Approval buttons still render for pending calls.
    expect(screen.getByText('Allow')).toBeInTheDocument()
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

    expect(screen.getByText('lib.rs')).toBeInTheDocument()
    expect(diffText(container)).toContain('fn new() {}')
    expect(diffText(container)).toContain('fn old() {}')
  })

  it('renders edit_file as a real line diff, keeping common lines as context', () => {
    render(
      <ToolCallBlock
        data={toolCall('edit_file', {
          file_path: 'src/app.py',
          old_string: 'line_a\nline_b\nline_c',
          new_string: 'line_a\nline_B\nline_c',
        })}
      />,
    )

    expect(screen.getByText('app.py')).toBeInTheDocument()
    expect(screen.getByText(/line_b/)).toBeInTheDocument()
    expect(screen.getByText(/line_B/)).toBeInTheDocument()
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

    expect(screen.getByText('todo.md')).toBeInTheDocument()
    expect(diffText(container)).toContain('# Todo')
    expect(diffText(container)).toContain('- item one')
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('shows an unrecognized patch format as plain text with real newlines', () => {
    render(<ToolCallBlock data={toolCall('apply_patch', { patch: 'not a real patch\nsecond line' })} />)

    expect(screen.getByText('not a real patch', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('second line', { exact: false })).toBeInTheDocument()
  })

  it('falls back to raw argument text while the JSON is still streaming', () => {
    // hljs splits the text into token spans, so assert on the args container.
    const partial = '{"path": "a.txt", "cont'
    const { container } = render(<ToolCallBlock data={toolCall('write_file', partial)} />)

    const args = container.querySelector('[data-slot="chat-tool-args"]')
    expect(args).not.toBeNull()
    expect(args!.textContent).toContain(partial)
  })
})
