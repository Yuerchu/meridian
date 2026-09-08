import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
import { api } from '@/api'
import { useConversationStore } from '@/stores/conversation-store'
import { ChatToolPresentationProvider } from '@/components/ui/chat-tool'
import { SubAgentGroup } from './sub-agent-group'
import { SubAgentSheetContext } from './sub-agent-sheet-context'
import { SubAgentSheetProvider } from './sub-agent-sheet'
import { ToolCallBlock } from './tool-call-block'
import type { MessageViewModel, ToolCallDisplay } from '@/types'

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(() => Promise.resolve()) }))
vi.mock('@/api', () => ({
  api: {
    approveToolCall: vi.fn().mockResolvedValue(undefined),
    denyToolCall: vi.fn().mockResolvedValue(undefined),
    respondToAsk: vi.fn().mockResolvedValue(undefined),
    workspaceResolveRef: vi.fn(),
    workspaceProbeRef: vi.fn(() => Promise.resolve(null)),
    getPlatform: vi.fn(() => Promise.resolve('windows')),
    conversationSnapshot: vi.fn(),
    activeUserShellTurn: vi.fn(() => Promise.resolve(null)),
  },
}))

function run(
  id: string,
  args: { agent: 'explore' | 'agent'; description: string },
  status: ToolCallDisplay['status'],
  over: Partial<ToolCallDisplay> = {},
): ToolCallDisplay {
  return {
    call_id: `call-${id}`,
    tool_name: 'run_agent',
    arguments: JSON.stringify({ ...args, prompt: 'p' }),
    status,
    ...over,
  }
}

const finished = (id: string, description: string, report: string): ToolCallDisplay =>
  run(id, { agent: 'explore', description }, 'completed', {
    result: `Sub-agent finished after 3 steps.\n\n${report}`,
    sub_agent: { conversation_id: `sub-${id}`, turn_id: `run-${id}`, kind: 'explore', steps: 3, status: 'done' },
  })

/** What the live path leaves on the card the moment a run comes back: the
 *  result has landed, and the `running` seeded when the run started is still
 *  there because nothing but a reload ever replaces it. */
const justFinished = (id: string, description: string, result: string): ToolCallDisplay =>
  run(id, { agent: 'explore', description }, 'completed', {
    result,
    sub_agent: { conversation_id: `sub-${id}`, turn_id: `run-${id}`, kind: 'explore', steps: 3, status: 'running' },
  })

const live = (id: string, description: string): ToolCallDisplay =>
  run(id, { agent: 'explore', description }, 'running', {
    sub_agent: { conversation_id: `sub-${id}`, turn_id: `run-${id}`, kind: 'explore', steps: 0, status: 'running' },
  })

function inBubble(ui: React.ReactNode) {
  return render(<ChatToolPresentationProvider value="bubble">{ui}</ChatToolPresentationProvider>)
}

const rowOf = (name: RegExp) => screen.getByRole('option', { name })

describe('SubAgentGroup', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.mocked(api.conversationSnapshot).mockReset()
    useConversationStore.setState({ sessions: {}, activeId: 'conv', subAgentSteps: {} })
    useConversationStore.getState().ensureSession('conv')
  })

  it('draws a round’s delegations as one group, a row each, with the count of each state', () => {
    const { container } = inBubble(
      <SubAgentGroup
        calls={[
          finished('1', 'Audit the cache', 'Nothing stale.'),
          live('2', 'Read the workers'),
          finished('3', 'Check the tests', 'Two skipped.'),
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-slot="sub-agent-group"]')).toHaveLength(1)
    expect(screen.getAllByRole('option')).toHaveLength(3)
    const header = container.querySelector('[data-slot="sub-agent-group-header"]')!
    expect(header).toHaveTextContent('Delegated 3 runs')
    expect(header).toHaveTextContent('2 finished')
    expect(header).toHaveTextContent('1 running')
    const ticks = container.querySelectorAll('[data-slot="sub-agent-group-tick"]')
    expect([...ticks].map((t) => t.getAttribute('data-state'))).toEqual(['done', 'running', 'done'])
  })

  it('shows a finished run’s verdict and the first line of its report, and keeps the report out', () => {
    const { container } = inBubble(
      <SubAgentGroup calls={[finished('1', 'Audit the cache', '## Findings\n\n- nothing stale\n- one miss')]} />,
    )
    const row = rowOf(/Audit the cache/)
    expect(row.querySelector('[data-slot="sub-agent-status"]')).toHaveAttribute('data-outcome', 'done')
    expect(row.querySelector('[data-slot="sub-agent-row-line"]')).toHaveTextContent('Findings')
    expect(within(row).queryByRole('heading')).toBeNull()
    expect(container.textContent).not.toContain('Sub-agent finished after')
    expect(container.textContent).not.toContain('one miss')
  })

  it('stops calling a run running once its result has landed, before any reload', () => {
    const { container } = inBubble(
      <SubAgentGroup
        calls={[justFinished('1', 'Audit the cache', 'Sub-agent finished after 3 steps.\n\nNothing stale.')]}
      />,
    )
    const row = rowOf(/Audit the cache/)
    expect(row).toHaveAttribute('data-state', 'done')
    expect(row.querySelector('[data-slot="sub-agent-status"]')).toHaveAttribute('data-outcome', 'done')
    expect(row.querySelector('[data-slot="sub-agent-row-line"]')).toHaveTextContent('Nothing stale.')
    const header = container.querySelector('[data-slot="sub-agent-group-header"]')!
    expect(header).toHaveTextContent('1 finished')
    expect(header).not.toHaveTextContent('running')
  })

  it('takes the verdict of such a run from the result, which is the only word the live path gets', () => {
    inBubble(
      <SubAgentGroup
        calls={[
          justFinished(
            '1',
            'Audit the cache',
            'Sub-agent was stopped after 3 steps because it kept repeating itself. Anything below is partial.\n\nHalf of it.',
          ),
        ]}
      />,
    )
    const row = rowOf(/Audit the cache/)
    // `aborted` is not a `TurnStatus`, so it exists only on this path.
    expect(row.querySelector('[data-slot="sub-agent-status"]')).toHaveAttribute('data-outcome', 'aborted')
    expect(row).toHaveAttribute('data-state', 'failed')
  })

  it('says what a live run is doing, read off its own session', () => {
    const message = {
      id: 'm-sub',
      role: 'assistant',
      turn_id: 'run-2',
      content: '',
      created_at: 1,
      _blocks: [
        { type: 'text', text: 'Looking at the workers.' },
        {
          type: 'tool_call',
          data: {
            call_id: 'c-inner',
            tool_name: 'read_file',
            arguments: JSON.stringify({ path: 'src/worker.rs' }),
            status: 'running',
          },
        },
      ],
    } as unknown as MessageViewModel
    useConversationStore.getState().ensureSession('sub-2')
    useConversationStore.setState((s) => ({
      sessions: { ...s.sessions, 'sub-2': { ...s.sessions['sub-2'], messages: [message] } },
      subAgentSteps: { 'run-2': 4 },
    }))
    inBubble(<SubAgentGroup calls={[live('2', 'Read the workers')]} />)
    const row = rowOf(/Read the workers/)
    const line = row.querySelector('[data-slot="sub-agent-row-line"]')!
    expect(line).toHaveAttribute('data-tone', 'live')
    expect(line).toHaveTextContent('Read File src/worker.rs')
    expect(row.querySelector('[data-slot="sub-agent-row-steps"]')).toHaveTextContent('4 steps')
  })

  it('asks the run’s question under the group, with the row marked as waiting', () => {
    const { container } = inBubble(
      <SubAgentGroup
        calls={[
          run('4', { agent: 'agent', description: 'Fix the callback' }, 'running', {
            sub_agent: { conversation_id: 'sub-4', turn_id: 'run-4', kind: 'agent', steps: 2, status: 'running' },
            nested_approval: {
              approval_id: 'appr-4',
              call_id: 'c-4',
              tool_name: 'run_command',
              arguments: JSON.stringify({ command: 'pytest -k aliyun' }),
            },
          }),
        ]}
      />,
    )
    expect(rowOf(/Fix the callback/)).toHaveAttribute('data-state', 'waiting')
    expect(container.querySelector('[data-slot="sub-agent-group-header"]')).toHaveTextContent('1 waiting on you')
    const question = container.querySelector('[data-slot="sub-agent-question"]')!
    expect(question).toHaveTextContent('pytest -k aliyun')
    expect(within(question).getByRole('button', { name: /Allow/ })).toBeVisible()
    expect(within(question).getByRole('button', { name: /Deny/ })).toBeVisible()
  })

  it('keeps the stranded note, which the parent is meant to read', () => {
    const note =
      'The user sent 1 message(s) to the sub-agent after it had stopped reading, so it never saw them. They are in its transcript. Read them before acting on the answer above.'
    const { container } = inBubble(<SubAgentGroup calls={[finished('1', 'Audit the cache', `Fine.\n\n${note}`)]} />)
    expect(container.querySelector('[data-slot="sub-agent-stranded"]')).toHaveTextContent(note)
  })

  it('opens the run’s conversation in the sheet when a row is pressed', async () => {
    const open = vi.fn()
    render(
      <SubAgentSheetContext value={{ open }}>
        <SubAgentGroup calls={[finished('1', 'Audit the cache', 'Fine.')]} />
      </SubAgentSheetContext>,
    )
    await userEvent.click(rowOf(/Audit the cache/))
    expect(open).toHaveBeenCalledWith({
      conversationId: 'sub-1',
      turnId: 'run-1',
      title: 'Audit the cache',
      kind: 'explore',
    })
  })

  it('falls back to switching conversation where nothing can draw the sheet', async () => {
    const openConversation = vi.fn()
    useConversationStore.setState({ openConversation })
    inBubble(<SubAgentGroup calls={[finished('1', 'Audit the cache', 'Fine.')]} />)
    await userEvent.click(rowOf(/Audit the cache/))
    expect(openConversation).toHaveBeenCalledWith('sub-1')
  })

  it('is what a lone run_agent key becomes', () => {
    const { container } = inBubble(<ToolCallBlock data={finished('1', 'Audit the cache', 'Fine.')} />)
    expect(container.querySelector('[data-slot="sub-agent-group"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="chat-tool-panel"]')).toBeNull()
  })
})

describe('SubAgentSheetProvider', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.mocked(api.conversationSnapshot).mockReset()
    useConversationStore.setState({ sessions: {}, activeId: 'conv', subAgentSteps: {} })
    useConversationStore.getState().ensureSession('conv')
  })

  it('loads the run’s conversation into the store and draws it, only once a row is pressed', async () => {
    vi.mocked(api.conversationSnapshot).mockResolvedValue({
      tree: { messages: [], branches: [] },
      pending_approvals: [],
      turns: [],
      sub_agent_runs: [],
      plan_reviews: [],
      plan_review_barrier: false,
    } as unknown as Awaited<ReturnType<typeof api.conversationSnapshot>>)
    render(
      <SubAgentSheetProvider>
        <SubAgentGroup calls={[finished('1', 'Audit the cache', 'Fine.')]} />
      </SubAgentSheetProvider>,
    )
    expect(api.conversationSnapshot).not.toHaveBeenCalled()
    await userEvent.click(rowOf(/Audit the cache/))
    expect(api.conversationSnapshot).toHaveBeenCalledWith({ conversationId: 'sub-1' })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Audit the cache' })).toBeVisible()
    expect(await within(dialog).findByText('Nothing recorded yet.')).toBeVisible()
  })

  /// A load that failed is not a run with nothing in it. `loadMessages` catches
  /// its own errors and answers `false`, so a `finally` reads a dead backend as
  /// a successful load and the sheet says "nothing recorded yet" about a run
  /// that has a transcript — with no error and no way to try again.
  it('says a failed load failed, and offers to try again', async () => {
    vi.mocked(api.conversationSnapshot).mockRejectedValue(new Error('backend is gone'))
    render(
      <SubAgentSheetProvider>
        <SubAgentGroup calls={[finished('1', 'Audit the cache', 'Fine.')]} />
      </SubAgentSheetProvider>,
    )
    await userEvent.click(rowOf(/Audit the cache/))
    const dialog = await screen.findByRole('dialog')

    const error = await within(dialog).findByText(/backend is gone/)
    expect(error).toBeVisible()
    expect(within(dialog).queryByText('Nothing recorded yet.')).toBeNull()
    // Not a skeleton either: that promises something is on its way.
    expect(dialog.querySelector('[data-slot="sub-agent-sheet-loading"]')).toBeNull()

    vi.mocked(api.conversationSnapshot).mockResolvedValue({
      tree: { messages: [], branches: [] },
      pending_approvals: [],
      turns: [],
      sub_agent_runs: [],
      plan_reviews: [],
      plan_review_barrier: false,
    } as unknown as Awaited<ReturnType<typeof api.conversationSnapshot>>)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByText('Nothing recorded yet.')).toBeVisible()
  })
})
