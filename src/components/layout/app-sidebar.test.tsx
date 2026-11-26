import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AppSidebar } from './app-sidebar'
import { useConversationStore, type ConversationSession } from '@/stores/conversation-store'
import { useUndoStore } from '@/stores/undo-store'
import i18n from '@/i18n'
import type { ConversationInfoResponse, ProjectInfoResponse } from '@/types'

const apiMocks = vi.hoisted(() => ({
  exportConversation: vi.fn(),
  listConversations: vi.fn((): Promise<ConversationInfoResponse[]> => Promise.resolve([])),
}))
const dialogMocks = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }))

vi.mock('@/api', () => ({
  api: {
    platform: {
      getInfo: () => Promise.resolve('windows'),
    },
    conversations: {
      export: apiMocks.exportConversation,
      // The archived rows of each group, loaded by the sidebar itself.
      list: () => apiMocks.listConversations(),
    },
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
    onDelete: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(undefined),
    onTogglePin: vi.fn().mockResolvedValue(undefined),
    onToggleArchive: vi.fn().mockResolvedValue(undefined),
    onMoveToProject: vi.fn().mockResolvedValue(null),
    page: 'chat',
    onOpenBoard: vi.fn(),
    onOpenStudio: vi.fn(),
    onOpenSettings: vi.fn(),
    onCloseSettings: vi.fn(),
    settingsTab: 'provider',
    onSettingsTabChange: vi.fn(),
    projects: PROJECTS,
    activeProjectId: null,
    onSelectProject: vi.fn(),
    onCreateProject: vi.fn(),
    onDeleteProject: vi.fn().mockResolvedValue(undefined),
    onRenameProject: vi.fn().mockResolvedValue(undefined),
    onCreateHostedSession: vi.fn().mockResolvedValue(null),
    ...over,
  }
  const ui = (current: typeof props, collapsed: boolean) => <AppSidebar {...current} isCollapsed={collapsed} />
  const view = render(ui(props, false))
  return {
    props,
    setPanelOpen: (open: boolean) => view.rerender(ui(props, !open)),
    update: (next: Partial<typeof props>) => view.rerender(ui({ ...props, ...next }, false)),
  }
}

/** A group's expanded conversation list (`ul.ui-nav-group__items`). */
function group(name: string) {
  return screen.getByRole('list', { name })
}

/** The NavItem button for a conversation inside `container` (excluding its row actions button). */
function convItem(container: HTMLElement, title: RegExp): HTMLElement {
  const match = within(container)
    .getAllByRole('button', { name: title })
    .find((el) => el.classList.contains('ui-nav-item'))
  if (!match) throw new Error(`No NavItem matching ${title}`)
  return match
}

function queryConvItem(container: HTMLElement, title: RegExp): HTMLElement | null {
  return (
    within(container)
      .queryAllByRole('button', { name: title })
      .find((el) => el.classList.contains('ui-nav-item')) ?? null
  )
}

describe('AppSidebar project groups', () => {
  beforeEach(() => useUndoStore.setState({ pending: null, hidden: new Set() }))

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

    expect(convItem(group('Meridian'), /侧边栏重构/)).toBeInTheDocument()
    expect(convItem(group('Meridian'), /表情包迁移/)).toBeInTheDocument()
    expect(queryConvItem(group('Meridian'), /群里在聊什么/)).not.toBeInTheDocument()
    expect(convItem(group('QQ 群'), /群里在聊什么/)).toBeInTheDocument()
    expect(convItem(group('对话'), /随便问问/)).toBeInTheDocument()

    // An empty project gets a header and no list — its header is still a drop
    // target, which is all an empty project has to offer.
    expect(screen.queryByRole('list', { name: '空项目' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠 空项目' })).toBeInTheDocument()
  })

  it('keeps the loose header as the unfile target when everything is filed', () => {
    renderSidebar({ conversations: CONVERSATIONS.filter((c) => c.project_id !== null) })
    expect(screen.queryByRole('list', { name: '对话' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '对话' })).toBeInTheDocument()
  })

  it('folds a group shut and open again', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: '折叠 Meridian' }))
    expect(screen.queryByRole('list', { name: 'Meridian' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('list', { name: 'QQ 群' })).not.toBeInTheDocument()

    update({ activeId: 'c-3' })
    await waitFor(() => expect(group('QQ 群')).toBeInTheDocument())
  })

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

      expect(queryConvItem(document.body, /计划审查/)).not.toBeInTheDocument()
      expect(convItem(group('Meridian'), /侧边栏重构/)).toBeInTheDocument()
      // No fold on a group with nothing to fold.
      expect(screen.getAllByRole('button', { name: '1 条审查会话' })).toHaveLength(1)

      await user.click(screen.getByRole('button', { name: '1 条审查会话' }))
      expect(convItem(group('1 条审查会话'), /计划审查/)).toBeInTheDocument()
    })

    it('opens the fold holding whatever is on screen', async () => {
      const { update } = renderSidebar({ conversations: [...CONVERSATIONS, REVIEW] })
      expect(queryConvItem(document.body, /计划审查/)).not.toBeInTheDocument()

      update({ activeId: 'c-review' })
      await waitFor(() => expect(convItem(group('1 条审查会话'), /计划审查/)).toBeInTheDocument())
    })
  })

  it('withholds every group from the icon rail', async () => {
    const user = userEvent.setup()
    const { setPanelOpen } = renderSidebar()
    // Fold one group first: the fold state has to survive the rail.
    await user.click(screen.getByRole('button', { name: '折叠 Meridian' }))

    setPanelOpen(false)
    expect(screen.queryByRole('list', { name: 'QQ 群' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '对话' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '折叠 QQ 群' })).not.toBeInTheDocument()
    // The rail keeps its destinations.
    expect(
      within(screen.getByRole('navigation', { name: '新对话' })).getByRole('button', { name: '新对话' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /搜索/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument()

    // Reopening restores the groups, with the fold untouched underneath.
    setPanelOpen(true)
    expect(group('QQ 群')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Meridian' })).not.toBeInTheDocument()
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
      await user.click(
        within(screen.getByRole('navigation', { name: '新对话' })).getByRole('button', { name: '新对话' }),
      )
      expect(props.onCreate).toHaveBeenCalledWith()
    })

    it('makes the loose group\u2019s "+" an explicitly loose conversation', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()
      await user.click(within(screen.getByRole('navigation', { name: '对话' })).getByRole('button', { name: '新对话' }))
      expect(props.onCreate).toHaveBeenCalledWith(null)
    })
  })

  it('opens the palette from the search row', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar()
    await user.click(screen.getByRole('button', { name: /搜索/ }))
    expect(props.onOpenSearch).toHaveBeenCalled()
  })

  it('says how long ago a conversation moved, until the pointer needs the room', () => {
    renderSidebar({
      conversations: [{ ...conversation('c-old', '旧对话', 'p-code'), updated_at: Date.now() - 7_200_000 }],
    })
    expect(convItem(group('Meridian'), /旧对话/)).toHaveTextContent('2小时前')
  })

  /**
   * A conversation row and a project's group header live under one right-click
   * handler, so the row itself says what was clicked — through `data-row-kind`.
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
        target: convItem(group('Meridian'), /侧边栏重构/),
      })

      const menu = await screen.findByRole('menu')
      expect(within(menu).getByText('置顶')).toBeInTheDocument()
    })

    async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
      await user.pointer({
        keys: '[MouseRight]',
        target: convItem(group('Meridian'), /侧边栏重构/),
      })
      return screen.findByRole('menu')
    }

    it('surfaces a failed pin', async () => {
      const user = userEvent.setup()
      renderSidebar({ onTogglePin: vi.fn().mockRejectedValue(new Error('db locked')) })
      await user.click(within(await openRowMenu(user)).getByText('置顶'))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        i18n.t('sidebar.pinFailed', { error: 'Error: db locked' }),
      )
    })

    it('takes a conversation away at once with an undo offer, and reports a delete that then fails', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockRejectedValue(new Error('still running'))
      renderSidebar({ onDelete })
      await user.click(within(await openRowMenu(user)).getByText(i18n.t('chat.delete')))

      // No question: the offer is the way back.
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(useUndoStore.getState().pending?.conversationId).toBe('c-1')
      expect(useUndoStore.getState().hidden.has('c-1')).toBe(true)
      expect(onDelete).not.toHaveBeenCalled()

      act(() => useUndoStore.getState().commit())
      expect(onDelete).toHaveBeenCalledWith('c-1')
      expect(await screen.findByRole('alert')).toHaveTextContent(
        i18n.t('sidebar.deleteFailed', { error: 'Error: still running' }),
      )
      // Failed, so it is shown again.
      expect(useUndoStore.getState().hidden.has('c-1')).toBe(false)
    })

    it('asks rather than offering undo while a ! command holds the conversation', async () => {
      const user = userEvent.setup()
      useConversationStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          'c-1': { streaming: false, activeShellTurnId: 'shell-1' } as ConversationSession,
        },
      }))
      try {
        renderSidebar()
        await user.click(within(await openRowMenu(user)).getByText(i18n.t('chat.delete')))
        expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
        expect(useUndoStore.getState().pending).toBeNull()
      } finally {
        useConversationStore.setState((state) => {
          const sessions = { ...state.sessions }
          delete sessions['c-1']
          return { sessions }
        })
      }
    })

    it('cancels an offer whose conversation started a turn while it stood', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockResolvedValue(undefined)
      renderSidebar({ onDelete })
      await user.click(within(await openRowMenu(user)).getByText(i18n.t('chat.delete')))
      useConversationStore.setState((state) => ({
        sessions: { ...state.sessions, 'c-1': { streaming: true, activeShellTurnId: null } as ConversationSession },
      }))
      try {
        act(() => useUndoStore.getState().commit())
        expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('sidebar.deleteCancelledBusy'))
        expect(onDelete).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(useUndoStore.getState().hidden.has('c-1')).toBe(false))
      } finally {
        useConversationStore.setState((state) => {
          const sessions = { ...state.sessions }
          delete sessions['c-1']
          return { sessions }
        })
      }
    })

    it('keeps a deleted archived conversation gone once its delete is done', async () => {
      const user = userEvent.setup()
      apiMocks.listConversations.mockResolvedValue([
        { ...conversation('c-old', '旧对话', 'p-code'), is_archived: true },
      ])
      try {
        renderSidebar()
        await user.click(await screen.findByRole('button', { name: i18n.t('sidebar.archivedCount', { count: 1 }) }))
        const archivedRow = await waitFor(() => convItem(group('1 条已归档对话'), /旧对话/))
        await user.pointer({ keys: '[MouseRight]', target: archivedRow })
        await user.click(within(await screen.findByRole('menu')).getByText(i18n.t('chat.delete')))
        expect(queryConvItem(document.body, /旧对话/)).toBeNull()

        act(() => useUndoStore.getState().commit())
        await vi.waitFor(() => expect(useUndoStore.getState().hidden.has('c-old')).toBe(false))
        expect(queryConvItem(document.body, /旧对话/)).toBeNull()
      } finally {
        apiMocks.listConversations.mockResolvedValue([])
      }
    })

    it('still asks before deleting a conversation with a turn running', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockResolvedValue(undefined)
      useConversationStore.setState((state) => ({
        sessions: { ...state.sessions, 'c-1': { streaming: true, activeShellTurnId: null } as ConversationSession },
      }))
      try {
        renderSidebar({ onDelete })
        await user.click(within(await openRowMenu(user)).getByText(i18n.t('chat.delete')))
        await user.click(
          within(await screen.findByRole('alertdialog')).getByRole('button', { name: i18n.t('common.delete') }),
        )
        expect(onDelete).toHaveBeenCalledWith('c-1')
        expect(useUndoStore.getState().pending).toBeNull()
      } finally {
        useConversationStore.setState((state) => {
          const sessions = { ...state.sessions }
          delete sessions['c-1']
          return { sessions }
        })
      }
    })

    it('surfaces a failed rename', async () => {
      const user = userEvent.setup()
      renderSidebar({ onRename: vi.fn().mockRejectedValue(new Error('too long')) })
      await user.click(within(await openRowMenu(user)).getByText('重命名'))
      const field = await screen.findByRole('textbox')
      await user.clear(field)
      await user.type(field, '新标题{Enter}')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        i18n.t('sidebar.renameFailed', { error: 'Error: too long' }),
      )
    })

    it('surfaces an export failure', async () => {
      const user = userEvent.setup()
      dialogMocks.save.mockResolvedValue('C:\\exports\\conversation.jsonl')
      apiMocks.exportConversation.mockRejectedValue(new Error('disk full'))
      renderSidebar()
      await user.pointer({
        keys: '[MouseRight]',
        target: convItem(group('Meridian'), /侧边栏重构/),
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

    await user.click(screen.getByRole('button', { name: /新建项目/ }))
    await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'New project')
    await user.click(screen.getByRole('button', { name: '选择目录…' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法创建项目：Error: permission denied')
    expect(screen.getByRole('textbox', { name: '项目名称' })).toHaveValue('New project')
  })

  describe('move to project', () => {
    it('moves a loose conversation into a chosen project', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()
      await user.pointer({ keys: '[MouseRight]', target: convItem(group('对话'), /随便问问/) })

      await user.click(within(await screen.findByRole('menu')).getByText('移动到项目…'))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('option', { name: /不归属项目/ })).toHaveAttribute('aria-disabled', 'true')
      await user.click(within(dialog).getByRole('option', { name: /Meridian/ }))

      expect(props.onMoveToProject).toHaveBeenCalledWith('c-loose', 'p-code')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('moves a filed conversation out to no project', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()
      await user.pointer({
        keys: '[MouseRight]',
        target: convItem(group('Meridian'), /侧边栏重构/),
      })

      await user.click(within(await screen.findByRole('menu')).getByText('移动到项目…'))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('option', { name: /Meridian/ })).toHaveAttribute('aria-disabled', 'true')
      await user.click(within(dialog).getByRole('option', { name: /不归属项目/ }))

      expect(props.onMoveToProject).toHaveBeenCalledWith('c-1', null)
    })

    it('keeps the dialog open and shows why a move was refused', async () => {
      const user = userEvent.setup()
      renderSidebar({ onMoveToProject: vi.fn().mockResolvedValue('conversation is busy') })
      await user.pointer({ keys: '[MouseRight]', target: convItem(group('对话'), /随便问问/) })

      await user.click(within(await screen.findByRole('menu')).getByText('移动到项目…'))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('option', { name: /Meridian/ }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('conversation is busy')
      expect(dialog).toBeInTheDocument()
    })
  })
})

/**
 * The age and the actions button share one row in Yuerchu UI's `NavItem`:
 * `[data-has-trailing]` swaps `trailing` for `actions` on React Aria's
 * `data-hovered` / `data-focus-within` rather than CSS `:hover`, so a touch
 * tap never leaves the timestamp hidden.
 */
describe('AppSidebar conversation time', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  function timeOf(title: RegExp): HTMLElement {
    const item = convItem(group('Meridian'), title)
    const el = item.querySelector<HTMLElement>('[data-slot="conversation-time"]')
    if (!el) throw new Error('no time')
    return el
  }

  it('keeps the time after a tap, because only a real pointer hover swaps it', async () => {
    const user = userEvent.setup()
    renderSidebar({
      conversations: [{ ...conversation('c-old', '旧对话', 'p-code'), updated_at: Date.now() - 7_200_000 }],
    })
    const item = convItem(group('Meridian'), /旧对话/)
    const row = item.closest<HTMLElement>('.ui-nav-list__row')
    expect(row).not.toBeNull()
    await user.pointer([{ keys: '[TouchA]', target: item }])
    expect(row).not.toHaveAttribute('data-hovered')
    expect(row).toHaveAttribute('data-has-trailing', '')
    const time = timeOf(/旧对话/)
    expect(time).toHaveTextContent('2小时前')
  })

  it('puts the actions button in the same row as the time', () => {
    renderSidebar()
    const row = timeOf(/侧边栏重构/).closest<HTMLElement>('.ui-nav-list__row')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByRole('button', { name: '侧边栏重构 的操作' })).toBeInTheDocument()
  })

  it('heads the right-click / long-press menu with the full time, as text rather than an item', async () => {
    const user = userEvent.setup()
    const at = new Date(2026, 8, 20, 14, 5).getTime()
    renderSidebar({ conversations: [{ ...conversation('c-t', '有时间的', 'p-code'), updated_at: at }] })
    await user.pointer({
      keys: '[MouseRight]',
      target: convItem(group('Meridian'), /有时间的/),
    })
    const menu = await screen.findByRole('menu')
    const exact = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(at)
    const heading = within(menu).getByText((text) => text.startsWith('更新于') && text.includes(exact))
    expect(heading.closest('[role="menuitem"]')).toBeNull()
    expect(within(menu).getByText('置顶')).toBeInTheDocument()
  })

  it('does not head a project menu with a time', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: 'Meridian' }) })
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByText(/^更新于/)).toBeNull()
  })
})
