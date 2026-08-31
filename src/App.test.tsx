import { act, render, screen, waitFor } from '@testing-library/react'

import App from './App'
import { useConversationStore } from '@/stores/conversation-store'
import type { InitialTurnDraft } from '@/components/chat/conversation-draft'
import type { ShellProps } from '@/components/layout/shell-props'
import type { Project } from '@/types'

const apiMocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  createProject: vi.fn(),
  acpOpenSession: vi.fn(),
  deleteConversation: vi.fn(),
  listConversations: vi.fn(),
  listProjects: vi.fn(),
  setConversationAssistant: vi.fn(),
  setConversationReasoningPrefs: vi.fn(),
  setConversationMode: vi.fn(),
  setConversationAcceptEdits: vi.fn(),
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
  pendingSticker: null,
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

const createdProject: Project = {
  id: 'project-new',
  name: 'New project',
  path: 'C:\\code\\new-project',
  source_type: 'local',
  source_id: null,
  assistant_id: null,
  description: null,
  created_at: 1,
  updated_at: 1,
}

async function renderApp() {
  render(<App />)
  await waitFor(() => {
    expect(apiMocks.listConversations).toHaveBeenCalledTimes(1)
    expect(apiMocks.listProjects).toHaveBeenCalledTimes(1)
  })
}

describe('creating a conversation from the welcome composer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    shellCapture.props = null
    useConversationStore.setState(useConversationStore.getInitialState(), true)

    apiMocks.listConversations.mockResolvedValue([])
    apiMocks.listProjects.mockResolvedValue([])
    apiMocks.createConversation.mockResolvedValue({ id: 'conversation-new' })
    apiMocks.createProject.mockResolvedValue(createdProject)
    apiMocks.acpOpenSession.mockResolvedValue('conversation-hosted')
    apiMocks.deleteConversation.mockResolvedValue(undefined)
    apiMocks.setConversationAssistant.mockResolvedValue(undefined)
    apiMocks.setConversationReasoningPrefs.mockResolvedValue(undefined)
    apiMocks.setConversationMode.mockResolvedValue(undefined)
    apiMocks.setConversationAcceptEdits.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('removes an empty conversation and keeps the draft unsent when a first-turn preference cannot be saved', async () => {
    const preferenceError = new Error('mode write failed')
    apiMocks.setConversationMode.mockRejectedValueOnce(preferenceError)
    let finishLastWrite!: () => void
    apiMocks.setConversationAcceptEdits.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLastWrite = resolve
        }),
    )
    await renderApp()

    let creation!: Promise<void>
    await act(async () => {
      creation = shellCapture.props!.onCreateWithDraft(draft)
      await Promise.resolve()
    })

    await waitFor(() => expect(apiMocks.setConversationMode).toHaveBeenCalled())
    // Deletion waits for every preference write to stop touching the row.
    expect(apiMocks.deleteConversation).not.toHaveBeenCalled()

    await act(async () => {
      finishLastWrite()
      await expect(creation).rejects.toBe(preferenceError)
    })

    expect(apiMocks.createConversation).toHaveBeenCalledTimes(1)
    expect(apiMocks.deleteConversation).toHaveBeenCalledWith('conversation-new')
    expect(apiMocks.listConversations).toHaveBeenCalledTimes(2)
    expect(useConversationStore.getState().activeId).toBeNull()
    expect(shellCapture.props?.pendingDraft).toBeNull()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-active-id', '')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-pending-draft', 'no')
  })

  it('enters the new conversation with the original draft even when the sidebar refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const refreshError = new Error('sidebar refresh failed')
    apiMocks.listConversations.mockResolvedValueOnce([]).mockRejectedValueOnce(refreshError)
    await renderApp()

    await act(async () => {
      await expect(shellCapture.props!.onCreateWithDraft(draft)).resolves.toBeUndefined()
    })

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to refresh conversations', refreshError)
    })
    expect(apiMocks.createConversation).toHaveBeenCalledTimes(1)
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
    apiMocks.listConversations.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh failed'))
    await renderApp()

    await act(async () => {
      await expect(Promise.resolve(shellCapture.props!.onCreate())).resolves.toBeUndefined()
    })

    expect(apiMocks.createConversation).toHaveBeenCalledTimes(1)
    expect(apiMocks.listConversations).toHaveBeenCalledTimes(2)
    expect(useConversationStore.getState().activeId).toBe('conversation-new')
    expect(useConversationStore.getState().conversations).toContainEqual(
      expect.objectContaining({ id: 'conversation-new' }),
    )
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-page', 'chat')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-active-id', 'conversation-new')
    expect(shellCapture.props?.pendingDraft).toBeNull()
  })

  it('keeps a created project locally and resolves the form mutation when its refresh fails', async () => {
    apiMocks.listProjects.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh failed'))
    await renderApp()

    await act(async () => {
      await expect(
        Promise.resolve(shellCapture.props!.onCreateProject(createdProject.name, createdProject.path!)),
      ).resolves.toBeUndefined()
    })

    expect(apiMocks.createProject).toHaveBeenCalledTimes(1)
    expect(apiMocks.listProjects).toHaveBeenCalledTimes(2)
    expect(useConversationStore.getState().projects).toContainEqual(createdProject)
  })

  it('navigates to a hosted session and reports success when only its refresh fails', async () => {
    apiMocks.listConversations.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh failed'))
    await renderApp()

    let result: string | null = 'not-called'
    await act(async () => {
      result = await shellCapture.props!.onCreateHostedSession('C:\\code\\hosted')
    })

    expect(result).toBeNull()
    expect(apiMocks.acpOpenSession).toHaveBeenCalledTimes(1)
    expect(apiMocks.listConversations).toHaveBeenCalledTimes(2)
    expect(useConversationStore.getState().activeId).toBe('conversation-hosted')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-page', 'chat')
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-active-id', 'conversation-hosted')
  })

  it('keeps the document title in sync with the shell title', async () => {
    await renderApp()
    expect(document.title).toBe('app.name')
  })
})
