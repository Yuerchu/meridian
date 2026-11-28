import { act, render, screen, waitFor } from '@testing-library/react'

import App from './App'
import { useConversationStore } from '@/stores/conversation-store'
import { useUndoStore } from '@/stores/undo-store'
import type { InitialTurnDraft } from '@/components/chat/conversation-draft'
import type { ShellProps } from '@/components/layout/shell-props'
import type { ProjectInfoResponse } from '@/types'

const apiMocks = vi.hoisted(() => ({
  conversations: {
    create: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  },
  projects: {
    create: vi.fn(),
    list: vi.fn(),
  },
  acp: {
    openSession: vi.fn(),
  },
}))

const shellCapture = vi.hoisted(() => ({ props: null as ShellProps | null }))

vi.mock('@/api', () => ({ api: apiMocks }))
vi.mock('@/hooks/use-context-menu-guard', () => ({ useContextMenuGuard: vi.fn() }))
vi.mock('@/hooks/use-global-event-listener', () => ({ useGlobalEventListener: vi.fn() }))
vi.mock('@/hooks/use-android-insets', () => ({ useAndroidInsets: vi.fn() }))
vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/layout/app-shell', () => ({
  AppShell: (props: ShellProps) => {
    shellCapture.props = props
    return (
      <div
        data-testid="app-shell"
        data-page={props.page}
        data-active-id={props.activeId ?? ''}
        data-pending-draft={props.pendingDraft ? 'yes' : 'no'}
      />
    )
  },
}))

const draft: InitialTurnDraft = {
  text: 'Inspect this repository',
  attachedFiles: [],
  voice: false,
  remainingComposer: null,
  settings: {
    selectedAssistantId: 'assistant-1',
    selectedModelId: 'model-1',
    selectedProviderId: 'provider-1',
    thinkingLevel: 'high',
    fastMode: true,
    mode: 'plan',
    acceptEdits: true,
  },
}

const createdProject: ProjectInfoResponse = {
  id: 'project-new',
  name: 'New project',
  path: 'C:\\code\\new-project',
  source_type: 'local',
  source_id: null,
  channel_kind: null,
  assistant_id: null,
  description: null,
  created_at: 1,
  updated_at: 1,
}

async function renderApp() {
  render(<App />)
  await waitFor(() => {
    expect(apiMocks.conversations.list).toHaveBeenCalledTimes(1)
    expect(apiMocks.projects.list).toHaveBeenCalledTimes(1)
  })
}

describe('creating a conversation from the welcome composer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    shellCapture.props = null
    useConversationStore.setState(useConversationStore.getInitialState(), true)

    apiMocks.conversations.list.mockResolvedValue([])
    apiMocks.projects.list.mockResolvedValue([])
    apiMocks.conversations.create.mockResolvedValue({ id: 'conversation-new' })
    apiMocks.projects.create.mockResolvedValue(createdProject)
    apiMocks.acp.openSession.mockResolvedValue('conversation-hosted')
    apiMocks.conversations.delete.mockResolvedValue(undefined)
    apiMocks.conversations.update.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('removes an empty conversation and keeps the draft unsent when a first-turn preference cannot be saved', async () => {
    const preferenceError = new Error('mode write failed')
    let finishLastWrite!: () => void
    apiMocks.conversations.update.mockImplementation((req: Record<string, unknown>) => {
      if ('mode' in req) return Promise.reject(preferenceError)
      if ('accept_edits' in req) {
        return new Promise<void>((resolve) => {
          finishLastWrite = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    await renderApp()

    let creation!: Promise<void>
    await act(async () => {
      creation = shellCapture.props!.onCreateWithDraft(draft)
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(apiMocks.conversations.update).toHaveBeenCalledWith(expect.objectContaining({ mode: 'plan' })),
    )
    // Deletion waits for every preference write to stop touching the row.
    expect(apiMocks.conversations.delete).not.toHaveBeenCalled()

    await act(async () => {
      finishLastWrite()
      await expect(creation).rejects.toBe(preferenceError)
    })

    expect(apiMocks.conversations.create).toHaveBeenCalledTimes(1)
    expect(apiMocks.conversations.delete).toHaveBeenCalledWith({ id: 'conversation-new' })
    expect(apiMocks.conversations.list).toHaveBeenCalledTimes(2)
    expect(useConversationStore.getState().activeId).toBeNull()
    expect(shellCapture.props?.pendingDraft).toBeNull()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-active-id', '')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-pending-draft', 'no')
  })

  it('enters the new conversation with the original draft even when the sidebar refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const refreshError = new Error('sidebar refresh failed')
    apiMocks.conversations.list.mockResolvedValueOnce([]).mockRejectedValueOnce(refreshError)
    await renderApp()

    await act(async () => {
      await expect(shellCapture.props!.onCreateWithDraft(draft)).resolves.toBeUndefined()
    })

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to refresh conversations', refreshError)
    })
    expect(apiMocks.conversations.create).toHaveBeenCalledTimes(1)
    expect(useConversationStore.getState().activeId).toBe('conversation-new')
    expect(useConversationStore.getState().conversations).toContainEqual(
      expect.objectContaining({ id: 'conversation-new', assistant_id: 'assistant-1' }),
    )
    expect(shellCapture.props?.pendingDraft).toBe(draft)
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-page', 'chat')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-active-id', 'conversation-new')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-pending-draft', 'yes')

    consoleError.mockRestore()
  })

  it('creates exactly one blank conversation for the welcome /new route even when refresh fails', async () => {
    apiMocks.conversations.list.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh failed'))
    await renderApp()

    await act(async () => {
      await expect(Promise.resolve(shellCapture.props!.onCreate())).resolves.toBeUndefined()
    })

    expect(apiMocks.conversations.create).toHaveBeenCalledTimes(1)
    expect(apiMocks.conversations.list).toHaveBeenCalledTimes(2)
    expect(useConversationStore.getState().activeId).toBe('conversation-new')
    expect(useConversationStore.getState().conversations).toContainEqual(
      expect.objectContaining({ id: 'conversation-new' }),
    )
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-page', 'chat')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-active-id', 'conversation-new')
    expect(shellCapture.props?.pendingDraft).toBeNull()
  })

  it('keeps a created project locally and resolves the form mutation when its refresh fails', async () => {
    apiMocks.projects.list.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh failed'))
    await renderApp()

    await act(async () => {
      await expect(
        Promise.resolve(shellCapture.props!.onCreateProject(createdProject.name, createdProject.path!)),
      ).resolves.toBeUndefined()
    })

    expect(apiMocks.projects.create).toHaveBeenCalledTimes(1)
    expect(apiMocks.projects.list).toHaveBeenCalledTimes(2)
    expect(useConversationStore.getState().projects).toContainEqual(createdProject)
  })

  it('navigates to a hosted session and reports success when only its refresh fails', async () => {
    apiMocks.conversations.list.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh failed'))
    await renderApp()

    let result: string | null = 'not-called'
    await act(async () => {
      result = await shellCapture.props!.onCreateHostedSession('C:\\code\\hosted')
    })

    expect(result).toBeNull()
    expect(apiMocks.acp.openSession).toHaveBeenCalledTimes(1)
    expect(apiMocks.acp.openSession).toHaveBeenCalledWith({ cwd: 'C:\\code\\hosted' })
    expect(apiMocks.conversations.list).toHaveBeenCalledTimes(2)
    expect(useConversationStore.getState().activeId).toBe('conversation-hosted')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-page', 'chat')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-active-id', 'conversation-hosted')
  })

  it('keeps the document title in sync with the shell title', async () => {
    await renderApp()
    expect(document.title).toBe('app.name')
  })
})

describe('deleting a conversation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    shellCapture.props = null
    useConversationStore.setState(useConversationStore.getInitialState(), true)
    useUndoStore.setState({ pending: null, hidden: new Set() })
    apiMocks.conversations.list.mockResolvedValue([])
    apiMocks.projects.list.mockResolvedValue([])
    apiMocks.conversations.delete.mockResolvedValue(undefined)
  })

  // An undo offer sends the delete seconds after it was asked for, through the
  // `onDelete` of that moment; by then the reader may have opened another one.
  it('leaves a conversation opened since the delete was asked for', async () => {
    await renderApp()
    act(() => useConversationStore.getState().setActiveId('conversation-a'))
    const askedWhileOpen = shellCapture.props!.onDelete
    act(() => useConversationStore.getState().setActiveId('conversation-b'))

    await act(async () => askedWhileOpen('conversation-a'))

    expect(apiMocks.conversations.delete).toHaveBeenCalledWith({ id: 'conversation-a' })
    expect(useConversationStore.getState().activeId).toBe('conversation-b')
  })

  it('draws no list with a conversation an undo offer is holding', async () => {
    apiMocks.conversations.list.mockResolvedValue([{ id: 'conversation-a' }, { id: 'conversation-b' }])
    await renderApp()
    await waitFor(() => expect(shellCapture.props!.conversations).toHaveLength(2))
    act(() =>
      useUndoStore.getState().offer({
        conversationId: 'conversation-a',
        title: null,
        commit: () => Promise.resolve(),
        restore: () => {},
      }),
    )
    expect(shellCapture.props!.conversations.map((c) => c.id)).toEqual(['conversation-b'])
  })
})
