import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
import { ComposerStatusTab, ProjectBranchChip } from './composer-status-tab'
import { TodoProgressChip } from './todo-progress-chip'
import type { TodoArgs } from './todo-list'

const TODOS: TodoArgs = {
  title: 'Update llama.cpp',
  todos: [
    { content: 'Download', active_form: 'Downloading', status: 'completed' },
    { content: 'Swap binary', active_form: 'Swapping binary', status: 'in_progress' },
    { content: 'Smoke test', active_form: 'Testing', status: 'pending' },
  ],
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('ComposerStatusTab', () => {
  it('is not drawn at all with nothing to say', () => {
    const { container } = render(<ComposerStatusTab progress={null} usage={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('holds its place while something is on its way', () => {
    render(<ComposerStatusTab pending />)
    expect(screen.getByRole('group', { name: i18n.t('composer.status') })).toBeInTheDocument()
  })

  it('draws whatever it was given, named as one group', () => {
    render(<ComposerStatusTab progress={<span>progress</span>} usage={<span>usage</span>} />)
    const tab = screen.getByRole('group', { name: i18n.t('composer.status') })
    expect(within(tab).getByText('progress')).toBeInTheDocument()
    expect(within(tab).getByText('usage')).toBeInTheDocument()
  })
})

describe('ProjectBranchChip', () => {
  it('names the branch, announced as one', () => {
    render(<ProjectBranchChip branch={{ status: 'branch', name: 'feat/design-parity' }} />)
    expect(screen.getByText('feat/design-parity')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('composer.branch'))).toHaveClass('sr-only')
  })

  it('says a detached HEAD in words rather than as a branch name', () => {
    render(<ProjectBranchChip branch={{ status: 'detached' }} />)
    expect(screen.getByText(i18n.t('composer.branchDetached'))).toBeInTheDocument()
  })

  it.each([{ status: 'loading' }, { status: 'none' }] as const)('draws nothing while $status', (branch) => {
    const { container } = render(<ProjectBranchChip branch={branch} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('TodoProgressChip', () => {
  it('shows the count and the step under way, and the whole list behind a press', async () => {
    const user = userEvent.setup()
    render(<TodoProgressChip todos={TODOS} />)
    const chip = screen.getByRole('button', { name: /Update llama\.cpp, 1\/3, Swapping binary/ })
    expect(within(chip).getByText('1/3')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(chip)
    const dialog = await screen.findByRole('dialog', { name: 'Update llama.cpp' })
    expect(within(dialog).getByText('Smoke test')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says nothing is under way when no step is in progress', () => {
    render(<TodoProgressChip todos={{ ...TODOS, todos: TODOS.todos.map((t) => ({ ...t, status: 'pending' })) }} />)
    expect(screen.getByText(i18n.t('chat.todo.idle'))).toBeInTheDocument()
  })
})

describe('the progress ring', () => {
  it('is drawn at 16px in the chip, not the ring default of 24px', () => {
    render(<TodoProgressChip todos={TODOS} />)
    const ring = document.querySelector('[data-slot="todo-progress-chip"] [role="progressbar"]')!
    expect(ring.className).toMatch(/\bsize-4\b/)
    expect(ring.className).not.toMatch(/\bsize-6\b/)
  })
})
