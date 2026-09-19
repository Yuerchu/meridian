import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '@/components/base'

import { AppSidebar } from './app-sidebar'
import i18n from '@/i18n'
import type { ConversationInfoResponse, ProjectInfoResponse } from '@/types'

const apiMocks = vi.hoisted(() => ({ exportConversation: vi.fn() }))
const dialogMocks = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }))

vi.mock('@/api', () => ({
  api: {
    getPlatform: () => Promise.resolve('windows'),
    exportConversation: apiMocks.exportConversation,
    // The archived rows of each group, loaded by the sidebar itself.
    listConversations: () => Promise.resolve([]),
  },
}))
vi.mock('@tauri-apps/plugin-dialog', () => dialogMocks)
// The dot beside a row subscribes to the store for streaming state; nothing
// here is streaming, and the real one drags the whole conversation store in.
vi.mock('./conversation-indicator', () => ({ ConversationIndicator: () => null }))

function project(id: string, name: string, sourceType = 'local'): ProjectInfoResponse {
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

function conversation(id: string, title: string, projectId: string | null): ConversationInfoResponse {
  return {
    id,
    title,
    assistant_id: null,
    is_pinned: false,
    is_archived: false,
    message_count: 1,
    created_at: 0,
    updated_at: 0,
    project_id: projectId,
    thinking_level: null,
    fast_mode: false,
    mode: null,
    head_message_id: null,
    accept_edits: false,
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
    onOpenSearch: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onMoveToProject: vi.fn().mockResolvedValue(null),
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
    onCreateHostedSession: vi.fn().mockResolvedValue(null),
    ...over,
  }
  // `collapsible="icon"` matches the app's provider — the icon-rail guard
  // reads it, so a default-collapsible provider here would never collapse.
  const ui = (current: typeof props, panelOpen: boolean) => (
    <Sidebar.Provider open={panelOpen} onOpenChange={() => {}} collapsible="icon">
      <AppSidebar {...current} />
    </Sidebar.Provider>
  )
  const view = render(ui(props, true))
  return {
    props,
    setPanelOpen: (open: boolean) => view.rerender(ui(props, open)),
    update: (next: Partial<typeof props>) => view.rerender(ui({ ...props, ...next }, true)),
  }
}

/** A group's conversation list — the panel copy only; the mobile sheet does
 *  not render above 768px, which is jsdom's default. */
function group(name: string) {
  return screen.getByRole('treegrid', { name })
}

describe('AppSidebar project groups', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  beforeEach(() => {
    apiMocks.exportConversation.mockReset()
    dialogMocks.open.mockReset()
    dialogMocks.save.mockReset()
  })

  it('renders one group per project, and the loose conversations in their own', () => {
    renderSidebar()

    expect(within(group('Meridian')).getByRole('row', { name: /侧边栏重构/ })).toBeInTheDocument()
    expect(within(group('Meridian')).getByRole('row', { name: /表情包迁移/ })).toBeInTheDocument()
    expect(within(group('Meridian')).queryByRole('row', { name: /群里在聊什么/ })).not.toBeInTheDocument()
    expect(within(group('QQ 群')).getByRole('row', { name: /群里在聊什么/ })).toBeInTheDocument()
    expect(within(group('对话')).getByRole('row', { name: /随便问问/ })).toBeInTheDocument()

    // An empty project gets a header and no list — its header is still a drop
    // target, which is all an empty project has to offer.
    expect(screen.queryByRole('treegrid', { name: '空项目' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠 空项目' })).toBeInTheDocument()
  })

  it('keeps the loose header as the unfile target when everything is filed', () => {
    renderSidebar({ conversations: CONVERSATIONS.filter((c) => c.project_id !== null) })
    expect(screen.queryByRole('treegrid', { name: '对话' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠 对话' })).toBeInTheDocument()
  })

  it('folds a group shut and open again', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: '折叠 Meridian' }))
    expect(screen.queryByRole('treegrid', { name: 'Meridian' })).not.toBeInTheDocument()
    // The other groups do not move.
    expect(group('QQ 群')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '展开 Meridian' }))
    expect(group('Meridian')).toBeInTheDocument()
  })

  /**
   * A conversation opened from the command palette or a notification is
   * current inside a group somebody folded shut, so the group opens itself.
   */
  it('unfolds the group holding whatever is on screen', async () => {
    const user = userEvent.setup()
    const { update } = renderSidebar()
    await user.click(screen.getByRole('button', { name: '折叠 QQ 群' }))
    expect(screen.queryByRole('treegrid', { name: 'QQ 群' })).not.toBeInTheDocument()

    update({ activeId: 'c-3' })
    await waitFor(() => expect(group('QQ 群')).toBeInTheDocument())
  })

  /**
   * The icon rail. The group labels would be `display: none` there while every
   * conversation row stayed behind as an anonymous icon, so nothing below the
   * header renders at all; the header and footer rows are the rail.
   */
  /**
   * The hook gates open one conversation per plan and per stop, and a project
   * under development collects dozens; they are folded under the group they
   * belong to and drawn only on request — or when one of them is on screen.
   */
  describe('reviews', () => {
    const REVIEW = { ...conversation('c-review', '计划审查：侧边栏', 'p-code'), agent_kind: 'plan_review' as const }

    it('folds them under the group until the fold is opened', async () => {
      const user = userEvent.setup()
      renderSidebar({ conversations: [...CONVERSATIONS, REVIEW] })

      expect(screen.queryByRole('row', { name: /计划审查/ })).not.toBeInTheDocument()
      expect(within(group('Meridian')).getByRole('row', { name: /侧边栏重构/ })).toBeInTheDocument()
      // No fold on a group with nothing to fold.
      expect(screen.getAllByRole('treegrid', { name: '1 条审查会话' })).toHaveLength(1)

      await user.click(screen.getByRole('row', { name: '1 条审查会话' }))
      expect(within(group('1 条审查会话')).getByRole('row', { name: /计划审查/ })).toBeInTheDocument()
      // Still out of the group's own list, which is the drop target.
      expect(within(group('Meridian')).queryByRole('row', { name: /计划审查/ })).not.toBeInTheDocument()
    })

    it('opens the fold holding whatever is on screen', async () => {
      const { update } = renderSidebar({ conversations: [...CONVERSATIONS, REVIEW] })
      expect(screen.queryByRole('row', { name: /计划审查/ })).not.toBeInTheDocument()

      update({ activeId: 'c-review' })
      await waitFor(() => expect(screen.getByRole('row', { name: /计划审查/ })).toBeInTheDocument())
    })
  })

  it('withholds every group from the icon rail', async () => {
    const user = userEvent.setup()
    const { setPanelOpen } = renderSidebar()
    // Fold one group first: the fold state has to survive the rail.
    await user.click(screen.getByRole('button', { name: '折叠 Meridian' }))

    setPanelOpen(false)
    expect(screen.queryByRole('treegrid', { name: 'QQ 群' })).not.toBeInTheDocument()
    expect(screen.queryByRole('treegrid', { name: '对话' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '折叠 QQ 群' })).not.toBeInTheDocument()
    // The rail keeps its destinations.
    expect(screen.getByRole('row', { name: /新对话/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /搜索/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /设置/ })).toBeInTheDocument()

    // Reopening restores the groups, with the fold untouched underneath.
    setPanelOpen(true)
    expect(group('QQ 群')).toBeInTheDocument()
    expect(screen.queryByRole('treegrid', { name: 'Meridian' })).not.toBeInTheDocument()
  })

  describe('project selection', () => {
    it('selects a project from its name, and deselects from a second press', async () => {
      const user = userEvent.setup()
      const { props, update } = renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Meridian' }))
      expect(props.onSelectProject).toHaveBeenCalledWith('p-code')

      update({ activeProjectId: 'p-code' })
      expect(screen.getByRole('button', { name: 'Meridian' })).toHaveAttribute('aria-pressed', 'true')
      await user.click(screen.getByRole('button', { name: 'Meridian' }))
      expect(props.onSelectProject).toHaveBeenLastCalledWith(null)
    })
  })

  describe('creating a conversation', () => {
    it('files a group\u2019s "+" into that project', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()
      await user.click(screen.getByRole('button', { name: '在 Meridian 中新建对话' }))
      expect(props.onCreate).toHaveBeenCalledWith('p-code')
    })

    it('leaves the header row to the default project', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()
      await user.click(screen.getByRole('row', { name: /新对话/ }))
      expect(props.onCreate).toHaveBeenCalledWith()
    })

    it('makes the loose group\u2019s "+" an explicitly loose conversation', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()
      // The loose group's "+" — the header row is a row, this is a button.
      await user.click(screen.getByRole('button', { name: '新对话' }))
      expect(props.onCreate).toHaveBeenCalledWith(null)
    })
  })

  it('opens the palette from the search row', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar()
    await user.click(screen.getByRole('row', { name: /搜索/ }))
    expect(props.onOpenSearch).toHaveBeenCalled()
  })

  it('says how long ago a conversation moved, until the pointer needs the room', () => {
    renderSidebar({
      conversations: [{ ...conversation('c-old', '旧对话', 'p-code'), updated_at: Date.now() - 7_200_000 }],
    })
    expect(within(group('Meridian')).getByRole('row', { name: /旧对话/ })).toHaveTextContent('2小时前')
  })

  /**
   * A conversation row and a project's group header live under one right-click
   * trigger, so the row itself says what was clicked — through
   * `data-row-kind`. Read wrong, a project would be offered "pin" and the
   * wrong confirmation, or a conversation a project's delete.
   */
  describe('right-click', () => {
    it('offers a project its own actions', async () => {
      const user = userEvent.setup()
      renderSidebar()
      await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: 'Meridian' }) })

      const menu = await screen.findByRole('menu')
      expect(within(menu).getByText('重命名')).toBeInTheDocument()
      expect(within(menu).queryByText('置顶')).not.toBeInTheDocument()
    })

    it('offers a conversation the conversation actions', async () => {
      const user = userEvent.setup()
      renderSidebar()
      await user.pointer({
        keys: '[MouseRight]',
        target: within(group('Meridian')).getByRole('row', { name: /侧边栏重构/ }),
      })

      const menu = await screen.findByRole('menu')
      expect(within(menu).getByText('置顶')).toBeInTheDocument()
    })

    it('surfaces an export failure', async () => {
      const user = userEvent.setup()
      dialogMocks.save.mockResolvedValue('C:\\exports\\conversation.jsonl')
      apiMocks.exportConversation.mockRejectedValue(new Error('disk full'))
      renderSidebar()
      await user.pointer({
        keys: '[MouseRight]',
        target: within(group('Meridian')).getByRole('row', { name: /侧边栏重构/ }),
      })

      const menu = await screen.findByRole('menu')
      await user.click(within(menu).getByText('导出 SFT 训练数据'))

      expect(await screen.findByRole('alert')).toHaveTextContent('无法导出对话：Error: disk full')
    })
  })

  it('keeps the new-project form open and reports a failed create', async () => {
    const user = userEvent.setup()
    const onCreateProject = vi.fn().mockRejectedValue(new Error('permission denied'))
    dialogMocks.open.mockResolvedValue('C:\\code\\new-project')
    renderSidebar({ onCreateProject })

    await user.click(screen.getByRole('row', { name: /新建项目/ }))
    await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'New project')
    await user.click(screen.getByRole('button', { name: '选择目录…' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法创建项目：Error: permission denied')
    expect(screen.getByRole('textbox', { name: '项目名称' })).toHaveValue('New project')
  })

  /**
   * Moving goes through a dialog rather than a submenu, so the same surface
   * serves the right-click menu and the touch menu. The current location is
   * disabled — the list also answers "where is this filed" — and choosing a
   * destination reports the bare project id, `null` for none.
   */
  describe('move to project', () => {
    it('moves a loose conversation into a chosen project', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()
      await user.pointer({ keys: '[MouseRight]', target: within(group('对话')).getByRole('row', { name: /随便问问/ }) })

      await user.click(within(await screen.findByRole('menu')).getByText('移动到项目…'))

      const dialog = await screen.findByRole('dialog')
      // Loose already: "no project" is where it is, not somewhere to go.
      expect(within(dialog).getByRole('button', { name: /不归属项目/ })).toBeDisabled()
      await user.click(within(dialog).getByRole('button', { name: /Meridian/ }))

      expect(props.onMoveToProject).toHaveBeenCalledWith('c-loose', 'p-code')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('moves a filed conversation out to no project', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()
      await user.pointer({
        keys: '[MouseRight]',
        target: within(group('Meridian')).getByRole('row', { name: /侧边栏重构/ }),
      })

      await user.click(within(await screen.findByRole('menu')).getByText('移动到项目…'))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('button', { name: /Meridian/ })).toBeDisabled()
      await user.click(within(dialog).getByRole('button', { name: /不归属项目/ }))

      expect(props.onMoveToProject).toHaveBeenCalledWith('c-1', null)
    })

    it('keeps the dialog open and shows why a move was refused', async () => {
      const user = userEvent.setup()
      renderSidebar({ onMoveToProject: vi.fn().mockResolvedValue('conversation is busy') })
      await user.pointer({ keys: '[MouseRight]', target: within(group('对话')).getByRole('row', { name: /随便问问/ }) })

      await user.click(within(await screen.findByRole('menu')).getByText('移动到项目…'))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /Meridian/ }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('conversation is busy')
      expect(dialog).toBeInTheDocument()
    })
  })
})
