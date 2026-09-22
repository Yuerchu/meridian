import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/base'
import { ToolCallBlock } from './tool-call-block'
import {
  ChatTool,
  ChatToolApproval,
  ChatToolContent,
  ChatToolPanelBody,
  ChatToolPresentationProvider,
  ChatToolTrigger,
} from '@/components/ui/chat-tool'
import { resetEditLocations } from '@/hooks/use-edit-location'
import i18n from '@/i18n'
import { api } from '@/api'
import { useConversationStore } from '@/stores/conversation-store'
import type { ToolCallDisplay } from '@/types'

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(() => Promise.resolve()) }))

vi.mock('@/api', () => ({
  api: {
    approveToolCall: vi.fn().mockResolvedValue(undefined),
    denyToolCall: vi.fn().mockResolvedValue(undefined),
    respondToAsk: vi.fn().mockResolvedValue(undefined),
    workspaceResolveRef: vi.fn(),
    conversationSnapshot: vi.fn(),
  },
}))

function call(toolName: string, args: unknown, status: ToolCallDisplay['status'], over: Partial<ToolCallDisplay> = {}) {
  return {
    call_id: `call-${toolName}-${status}`,
    tool_name: toolName,
    arguments: JSON.stringify(args),
    status,
    ...(status === 'pending' ? { approval_id: 'appr-1' } : {}),
    ...over,
  } satisfies ToolCallDisplay
}

function inBubble(ui: React.ReactNode) {
  return render(<ChatToolPresentationProvider value="bubble">{ui}</ChatToolPresentationProvider>)
}

const panel = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-slot="chat-tool-panel"]')!

describe('tool panels', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    resetEditLocations()
    vi.mocked(api.workspaceResolveRef).mockReset()
    vi.mocked(api.conversationSnapshot).mockReset()
    useConversationStore.setState({ sessions: {}, activeId: 'conv' })
    useConversationStore.getState().ensureSession('conv')
  })

  /// The screenshot that started this: a pending command drawn as
  /// `{"command": "cd \"...\" && ...", "description": "..."}`.
  it('draws a command as code and its output in parts, never as JSON', async () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={call('run_command', { command: 'ls -la', description: 'List the directory' }, 'completed', {
          result: 'total 0\n[stderr] warning: slow disk\n[exit code: 2]',
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Run Command/ }))
    const p = panel(container)
    expect(p.querySelector('[data-slot="chat-tool-args"]')).toBeNull()
    expect(p.textContent).not.toContain('"command"')
    expect(p.querySelector('[data-slot="command-code"]')).toHaveTextContent('ls -la')
    expect(p.querySelector('[data-slot="command-output"]')).toHaveTextContent('total 0')
    expect(p.querySelector('[data-slot="command-stderr"]')).toHaveTextContent('warning: slow disk')
    // The trailer is a chip, not a line of the output.
    expect(p.textContent).not.toContain('[exit code')
    expect(within(p).getByText('exit 2')).toBeVisible()
    // What the command is for, at the top, since the command itself is below.
    expect(p.querySelector('[data-slot="chat-tool-panel-title"]')).toHaveTextContent('List the directory')
  })

  /// A hosted agent's shell writes no trailer, and "no exit code" is not
  /// "exit 0".
  it('claims no exit code when the shell wrote none', async () => {
    const { container } = inBubble(
      <ToolCallBlock data={call('Bash', { command: 'echo hi' }, 'completed', { result: 'hi' })} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Run Command/ }))
    expect(panel(container).textContent).not.toMatch(/exit \d/)
  })

  /// The other screenshot: a deeply nested worktree path on a write waiting to
  /// be approved.
  it('shows a key waiting on a decision its whole path, unclamped', () => {
    const path = '/home/user/projects/acme-backend/.worktrees/feat-api/api/__init__.py'
    const { container } = inBubble(<ToolCallBlock data={call('write_file', { path, content: 'x' }, 'pending')} />)
    const key = container.querySelector<HTMLElement>('[data-slot="chat-tool-trigger"]')!
    const arg = key.querySelector<HTMLElement>('[data-slot="tool-arg"]')!
    expect(arg).toHaveTextContent(path)
    expect(arg.className).not.toMatch(/line-clamp/)
    expect(arg.querySelector('[data-slot="path-dir"]')!.className).not.toMatch(/truncate/)
    expect(arg.querySelector('[data-slot="path-name"]')).toHaveTextContent('__init__.py')
  })

  it('keeps an ordinary key to one line with the file name intact', async () => {
    const path = '/home/me/very/deep/directory/structure/for/this/test/turn.rs'
    const { container } = inBubble(<ToolCallBlock data={call('read_file', { path }, 'completed', { result: 'fn' })} />)
    const arg = container.querySelector<HTMLElement>('[data-slot="tool-arg"]')!
    expect(arg.querySelector('[data-slot="path-dir"]')!.className).toMatch(/truncate/)
    expect(arg.querySelector('[data-slot="path-name"]')).toHaveTextContent('turn.rs')
    // The panel is where the whole path is, since the key could not hold it.
    await userEvent.click(screen.getByRole('button', { name: /Read File/ }))
    expect(panel(container).querySelector('[data-slot="chat-tool-panel-title"]')).toHaveTextContent(path)
  })

  it('numbers a whole-file write from one and puts its stats in the header', () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={call('write_file', { path: 'notes/todo.md', content: '# Todo\n- one\n- two\n' }, 'pending')}
      />,
    )
    const p = panel(container)
    // One file, one header: the panel's. No second header naming it again.
    expect(p.querySelector('[data-slot="file-diff-header"]')).toBeNull()
    expect(p.querySelector('[data-slot="chat-tool-panel-end"]')).toHaveTextContent('+3')
    const gutters = Array.from(p.querySelectorAll('[data-slot="file-diff-gutter"]')).map((g) => g.textContent?.trim())
    expect(gutters).toEqual(['1', '2', '3'])
  })

  /// The edit names a string, not a line. The file says where the string is.
  it('places a pending edit by reading the file it is about to change', async () => {
    vi.mocked(api.workspaceResolveRef).mockResolvedValue({
      kind: 'project_file',
      path: 'src/app.py',
      content: 'import os\r\n\r\ndef main():\r\n    return 1\r\n',
      line_start: null,
      line_end: null,
      byte_count: 40,
      line_count: 4,
      token_count: 10,
      truncated: false,
    })
    const { container } = inBubble(
      <ToolCallBlock
        data={call(
          'edit_file',
          { file_path: 'src/app.py', old_string: 'def main():', new_string: 'def main() -> int:' },
          'pending',
        )}
      />,
    )
    await waitFor(() => {
      const gutters = Array.from(panel(container).querySelectorAll('[data-slot="file-diff-gutter"]'))
      expect(gutters.length).toBeGreaterThan(0)
    })
    const first = panel(container).querySelector(
      '[data-slot="file-diff-line"][data-kind="remove"] [data-slot="file-diff-gutter"]',
    )!
    expect(first.textContent?.trim()).toBe('3')
    expect(api.workspaceResolveRef).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv', path: 'src/app.py', lineStart: null, lineEnd: null }),
    )
  })

  /// After the edit ran the file has changed; a number read off it now would
  /// be a guess wearing a gutter.
  it('asks for no file once the edit has run, and draws no numbers', async () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={call('edit_file', { file_path: 'src/app.py', old_string: 'a', new_string: 'b' }, 'completed', {
          result: 'Replaced 1 occurrence(s) in src/app.py',
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Edit File/ }))
    expect(api.workspaceResolveRef).not.toHaveBeenCalled()
    expect(panel(container).querySelector('[data-slot="file-diff-gutter"]')).toBeNull()
    // The confirmation is the footer's sentence, not a block of result text.
    expect(panel(container).querySelector('[data-slot="chat-tool-panel-footer"]')).toHaveTextContent(
      'Replaced 1 occurrence(s) in src/app.py',
    )
    expect(panel(container).querySelector('[data-slot="generic-result"]')).toBeNull()
  })

  it('lists glob matches as paths, with the cap as a footnote', async () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={call('glob', { pattern: '**/*.ts' }, 'completed', {
          result: 'src/a.ts\nsrc/lib/b.ts\n\n(showing first 1000 matches)',
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Glob Files/ }))
    const list = panel(container).querySelector('[data-slot="glob-result"]')!
    expect(list.querySelectorAll('[data-slot="path-label"]')).toHaveLength(2)
    expect(list).toHaveTextContent('b.ts')
    expect(panel(container).querySelector('[data-slot="tool-footnote"]')).toHaveTextContent('first 1000')
    expect(panel(container).textContent).not.toContain('(showing first')
  })

  it('reads a directory listing into rows', async () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={call('list_directory', { path: 'src' }, 'completed', {
          result: 'dir          -  lib\nfile    1.2 KB  main.rs',
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /List Directory/ }))
    const rows = panel(container).querySelectorAll('[data-slot="directory-result"] > div')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('main.rs')
    expect(rows[1]).toHaveTextContent('1.2 KB')
  })

  it('puts the decision row in the panel’s footer, wherever it was rendered', () => {
    const { container } = inBubble(
      <ChatTool state="requires-action" defaultExpanded>
        <ChatToolTrigger>Write file</ChatToolTrigger>
        <ChatToolContent>
          <ChatToolPanelBody>
            <div>
              <ChatToolApproval>
                <Button>Deny</Button>
                <Button>Allow</Button>
              </ChatToolApproval>
            </div>
          </ChatToolPanelBody>
        </ChatToolContent>
      </ChatTool>,
    )
    const p = panel(container)
    const footer = p.querySelector('[data-slot="chat-tool-panel-footer"]')!
    expect(footer).toContainElement(p.querySelector('[data-slot="chat-tool-approval-actions"]'))
    expect(
      p.querySelector('[data-slot="chat-tool-panel-body"]')!.querySelector('[data-slot="chat-tool-approval"]'),
    ).toBeNull()
  })
})

describe('every panel opens the same way', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    useConversationStore.setState({ sessions: {}, activeId: 'conv' })
    useConversationStore.getState().ensureSession('conv')
  })

  /// A search used to draw its pattern in the header and then a key/value
  /// table of pattern and path under it — the same values twice, in two
  /// shapes. The title is the pattern; the path is the meta line; the body
  /// is the matches, and nothing else.
  it('names a search by its pattern with the rest of its arguments as a meta line', async () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={call(
          'search_files',
          { pattern: 'class UserFileBase', path: 'C:/proj/src', max_results: 50 },
          'completed',
          {
            result: 'C:/proj/src/base.py:46:class UserFileBase(SQLModelBase):',
          },
        )}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Search Files/ }))
    const p = panel(container)
    expect(p.querySelector('[data-slot="chat-tool-panel-title"]')).toHaveTextContent('class UserFileBase')
    const meta = p.querySelector('[data-slot="tool-args-meta"]')!
    expect(meta).toHaveTextContent('C:/proj/src')
    expect(meta).toHaveTextContent('50')
    expect(meta.textContent).not.toContain('class UserFileBase')
    expect(p.querySelector('[data-slot="tool-args-list"]')).toBeNull()
    expect(p.querySelector('[data-slot="search-result"]')).toHaveTextContent('class UserFileBase(SQLModelBase):')
  })

  /// A tool with no shape of its own used to open on a bare argument table
  /// and a wall of text. It opens on a title like every other panel — its
  /// first short argument — and a skill's text is drawn as the Markdown it is.
  it('gives a tool with no known shape a title from its first argument and draws a skill as prose', async () => {
    const { container } = inBubble(
      <ToolCallBlock
        data={call('load_skill', { skill_name: 'claude-code-plan-review' }, 'completed', {
          result: '# Skill: claude-code-plan-review\n\n## Review procedure\n\n1. Identify the goal.',
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Load Skill/ }))
    const p = panel(container)
    expect(p.querySelector('[data-slot="chat-tool-panel-title"]')).toHaveTextContent('claude-code-plan-review')
    expect(p.querySelector('[data-slot="tool-args-list"]')).toBeNull()
    expect(within(p).getByRole('heading', { name: 'Review procedure' })).toBeVisible()
    expect(p.querySelector('pre')).toBeNull()
  })

  /// A long argument is a body, not a name: it stays out of the title and
  /// gets a block of its own.
  it('keeps a long argument out of the title and in a block of its own', async () => {
    const prompt = 'x'.repeat(200)
    const { container } = inBubble(
      <ToolCallBlock
        data={call('mcp__notes__append', { prompt, tag: 'daily' }, 'completed', { result: '{"ok":true}' })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /mcp__notes__append/ }))
    const p = panel(container)
    expect(p.querySelector('[data-slot="chat-tool-panel-title"]')).toHaveTextContent('daily')
    expect(p.querySelector('[data-slot="tool-args-list"]')).toHaveTextContent(prompt)
    expect(p.querySelector('[data-slot="tool-args-meta"]')).toBeNull()
  })
})
