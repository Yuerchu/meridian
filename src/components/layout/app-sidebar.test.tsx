import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '@heroui-pro/react/sidebar'

import { AppSidebar } from './app-sidebar'
import i18n from '@/i18n'
import type { Conversation, Project } from '@/types'

vi.mock('@/api', () => ({ api: { getPlatform: () => Promise.resolve('windows') } }))
// The dot beside a row subscribes to the store for streaming state; nothing
// here is streaming, and the real one drags the whole conversation store in.
vi.mock('./conversation-indicator', () => ({ ConversationIndicator: () => null }))

function project(id: string, name: string, sourceType = 'local'): Project {
  return {
    id,
    name,
    path: sourceType === 'local' ? `/code/${id}` : null,
    source_type: sourceType,
    source_id: null,
    assistant_id: null,
    description: null,
    created_at: 0,
    updated_at: 0,
  }
}

function conversation(id: string, title: string, projectId: string | null): Conversation {
  return {
    id,
    title,
    assistant_id: null,
    is_pinned: 0,
    is_archived: 0,
    message_count: 1,
    created_at: 0,
    updated_at: 0,
    project_id: projectId,
    compact_cursor: null,
    thinking_level: null,
    fast_mode: 0,
    mode: null,
    head_message_id: null,
    accept_edits: 0,
  }
}

const PROJECTS = [project('p-code', 'Meridian'), project('p-qq', 'QQ 群', 'onebot_group'), project('p-new', '空项目')]

const CONVERSATIONS = [
  conversation('c-1', '侧边栏重构', 'p-code'),
  conversation('c-2', '表情包迁移', 'p-code'),
  conversation('c-3', '群里在聊什么', 'p-qq'),
  conversation('c-loose', '随便问问', null),
]

function renderSidebar(over: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  const props: React.ComponentProps<typeof AppSidebar> = {
    conversations: CONVERSATIONS,
    activeId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    page: 'chat',
    onOpenSettings: vi.fn(),
    onCloseSettings: vi.fn(),
    settingsTab: 'provider',
    onSettingsTabChange: vi.fn(),
    projects: PROJECTS,
    activeProjectId: null,
    onSelectProject: vi.fn(),
    onCreateProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    ...over,
  }
  render(
    <Sidebar.Provider>
      <AppSidebar {...props} />
    </Sidebar.Provider>,
  )
  return props
}

/** The panel copy only — the mobile sheet renders the same tree a second time. */
function tree() {
  return screen.getByRole('treegrid', { name: '项目' })
}

function row(name: string | RegExp) {
  return within(tree()).getByRole('row', { name })
}

describe('AppSidebar project tree', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('nests a project’s conversations under it, and leaves the rest alone', async () => {
    const user = userEvent.setup()
    renderSidebar()

    // Collapsed to begin with: a project's conversations are not in the
    // collection at all until it is opened.
    expect(within(tree()).queryByRole('row', { name: /侧边栏重构/ })).not.toBeInTheDocument()

    // Pro's own chevron, named by React Aria in English — see the note in
    // `app-sidebar.tsx` about where that label comes from.
    // Pro's own chevron, named by React Aria: `aria-label` from its own string
    // table plus the row's label. English here only because this file renders
    // no `I18nProvider` — the app has one, and RAC ships a zh-CN table.
    await user.click(within(row(/Meridian/)).getByRole('button', { name: 'Expand Meridian' }))

    const nested = await within(tree()).findByRole('row', { name: /侧边栏重构/ })
    expect(nested).toHaveAttribute('aria-level', '2')
    expect(row(/Meridian/)).toHaveAttribute('aria-level', '1')
    // The other project stays shut.
    expect(within(tree()).queryByRole('row', { name: /群里在聊什么/ })).not.toBeInTheDocument()
  })

  /**
   * The chevron is Pro's, and it only exists on a row RAC found children for.
   * Rendering `Sidebar.MenuTrigger` unconditionally is what lets that be true
   * without this file deciding it.
   */
  it('gives no expander to a project with no conversations', () => {
    renderSidebar()
    expect(row(/Meridian/)).toHaveAttribute('data-has-child-items')
    expect(row(/空项目/)).not.toHaveAttribute('data-has-child-items')
  })

  /**
   * A conversation opened from the command palette or a notification is current
   * inside a branch that was never opened, so the branch opens itself.
   */
  it('opens the project holding whatever is on screen', async () => {
    renderSidebar({ activeId: 'c-3' })
    await waitFor(() => expect(within(tree()).getByRole('row', { name: /群里在聊什么/ })).toBeInTheDocument())
    expect(row(/QQ 群/)).toHaveAttribute('data-expanded')
  })

  /** Conversations belonging to no project keep a flat group of their own. */
  it('keeps unfiled conversations out of the tree', () => {
    renderSidebar()
    const loose = screen.getByRole('treegrid', { name: '对话' })
    expect(within(loose).getByRole('row', { name: /随便问问/ })).toBeInTheDocument()
    expect(within(loose).queryByRole('row', { name: /侧边栏重构/ })).not.toBeInTheDocument()
  })

  it('drops the group entirely when everything is filed', () => {
    renderSidebar({ conversations: CONVERSATIONS.filter((c) => c.project_id !== null) })
    expect(screen.queryByRole('treegrid', { name: '对话' })).not.toBeInTheDocument()
  })

  /**
   * Projects and their conversations share one tree, so the list a right-click
   * landed in no longer says what was clicked — the row does, through
   * `data-row-kind`. Read wrong, a project would be offered "pin" and the wrong
   * confirmation, or a conversation would be offered a project's delete.
   */
  describe('right-click', () => {
    it('offers a project its own actions', async () => {
      const user = userEvent.setup()
      renderSidebar()
      await user.pointer({ keys: '[MouseRight]', target: row(/Meridian/) })

      const menu = await screen.findByRole('menu')
      expect(within(menu).getByText('重命名')).toBeInTheDocument()
      expect(within(menu).queryByText('置顶')).not.toBeInTheDocument()
    })

    it('offers a nested conversation the conversation actions', async () => {
      const user = userEvent.setup()
      renderSidebar({ activeId: 'c-1' })
      const nested = await within(tree()).findByRole('row', { name: /侧边栏重构/ })
      await user.pointer({ keys: '[MouseRight]', target: nested })

      const menu = await screen.findByRole('menu')
      expect(within(menu).getByText('置顶')).toBeInTheDocument()
    })
  })
})
