import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolCallBlock } from './tool-call-block'
import { ChatToolPresentationProvider } from '@/components/ui/chat-tool'
import { resetEditLocations } from '@/hooks/use-edit-location'
import i18n from '@/i18n'
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

/**
 * No tool call is drawn as its JSON source — not a result nobody has a parser
 * for, not an argument that is an object, not a form's answers. The shapes are
 * the ones that used to show up as `{"…": …}` in a code box.
 */
function call(toolName: string, args: unknown, over: Partial<ToolCallDisplay> = {}): ToolCallDisplay {
  return {
    call_id: `call-${toolName}`,
    tool_name: toolName,
    arguments: JSON.stringify(args),
    status: 'completed',
    ...over,
  }
}

function open(ui: React.ReactNode) {
  return render(<ChatToolPresentationProvider value="bubble">{ui}</ChatToolPresentationProvider>)
}

/** JSON source on screen: an object key in quotes followed by a colon. */
const JSON_SOURCE = /"[A-Za-z_]+"\s*:/

describe('structured tool display', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    resetEditLocations()
    useConversationStore.setState({ sessions: {}, activeId: 'conv' })
    useConversationStore.getState().ensureSession('conv')
  })

  it('draws an MCP tool’s JSON answer as fields and a table', async () => {
    const result = JSON.stringify({
      ok: true,
      items: [
        { id: 1, name: 'alpha' },
        { id: 2, name: 'beta' },
      ],
    })
    const { container } = open(<ToolCallBlock data={call('mcp__notes__search', { query: 'x' }, { result })} />)
    await userEvent.click(screen.getByRole('button', { name: /mcp__notes__search/ }))
    expect(container.querySelector('[data-slot="tool-structured-result"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="tool-value-table"]')).not.toBeNull()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(JSON_SOURCE)
  })

  it('draws an object argument as fields, not its source', async () => {
    const { container } = open(
      <ToolCallBlock
        data={call('mcp__db__query', { filter: { owner: 'me', tags: ['a', 'b'] }, limit: 5 }, { result: 'done' })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /mcp__db__query/ }))
    expect(container.querySelector('[data-slot="tool-fields"]')).not.toBeNull()
    expect(screen.getByText('owner')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(JSON_SOURCE)
  })

  it('draws MCP content parts by kind', async () => {
    const result = JSON.stringify([
      { type: 'text', text: 'first part' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ])
    const { container } = open(<ToolCallBlock data={call('mcp__x__y', {}, { result })} />)
    await userEvent.click(screen.getByRole('button', { name: /mcp__x__y/ }))
    expect(screen.getByText('first part')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="tool-value-image"]')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    )
    expect(container.textContent).not.toMatch(JSON_SOURCE)
  })

  it('draws a form’s answers against their questions', async () => {
    const { container } = open(
      <ToolCallBlock
        data={call(
          'ask_user',
          { questions: [{ id: 'color', question: 'Which colour?' }] },
          { result: JSON.stringify({ color: 'Blue' }) },
        )}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Ask|Question/ }))
    expect(container.querySelector('[data-slot="ask-user-answers"]')).not.toBeNull()
    expect(screen.getAllByText('Which colour?').length).toBeGreaterThan(0)
    expect(screen.getByText('Blue')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(JSON_SOURCE)
  })

  it('draws Claude Code’s TodoWrite as the checklist', () => {
    const { container } = open(
      <ToolCallBlock
        data={call('TodoWrite', {
          todos: [
            { content: 'Write it', status: 'completed', activeForm: 'Writing it' },
            { content: 'Test it', status: 'in_progress', activeForm: 'Testing it' },
          ],
        })}
      />,
    )
    expect(container.querySelector('[data-slot="todo-progress"]')).toHaveTextContent('1')
    expect(container.textContent).not.toMatch(JSON_SOURCE)
  })

  it('draws a JSON result of a built-in tool as fields', async () => {
    const { container } = open(
      <ToolCallBlock
        data={call('list_stickers', {}, { result: JSON.stringify([{ sticker_id: 's1', name: 'wave', tags: ['hi'] }]) })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /sticker/i }))
    expect(screen.getByText('wave')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(JSON_SOURCE)
  })
})
