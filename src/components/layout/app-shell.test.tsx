import { act, render, screen, waitFor } from '@testing-library/react'

import { AppShell } from './app-shell'
import type { ShellProps } from './shell-props'
import { clearSettingsTabDirty, isSettingsTabDirty, setSettingsTabDirty } from '@/components/settings/dirty-guard'

interface SidebarCallbacks {
  onSelect: (id: string) => void
  onCreate: () => void | Promise<void>
  onCloseSettings: () => void
  onSettingsTabChange: (tab: ShellProps['settingsTab']) => void
}

const confirmMocks = vi.hoisted(() => ({ confirm: vi.fn() }))
const sidebarCapture = vi.hoisted(() => ({ props: null as SidebarCallbacks | null }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/use-confirm', () => ({
  useConfirm: () => ({ confirm: confirmMocks.confirm, confirmDialog: null }),
}))
vi.mock('@/hooks/use-history-level', () => ({
  useBackGesture: vi.fn(),
  useHistoryLevel: vi.fn(),
}))
vi.mock('@/hooks/use-hotkey', () => ({ useHotkey: vi.fn() }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))

vi.mock('@gravity-ui/icons', () => ({
  FolderTree: () => null,
  Magnifier: () => null,
  Xmark: () => null,
}))
vi.mock('@heroui/react', () => {
  const Tooltip = Object.assign(({ children }: { children: React.ReactNode }) => <>{children}</>, {
    Content: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  })
  const Kbd = Object.assign(({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>, {
    Content: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  })
  const Alert = Object.assign(
    ({ children, status: _status, ...props }: React.HTMLAttributes<HTMLDivElement> & { status?: string }) => (
      <div {...props}>{children}</div>
    ),
    {
      Indicator: () => null,
      Content: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      Description: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    },
  )
  return {
    Alert,
    Kbd,
    Button: ({
      children,
      onPress,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { onPress?: () => void }) => (
      <button {...props} onClick={onPress}>
        {children}
      </button>
    ),
    Tooltip,
  }
})
vi.mock('@/components/base', () => ({
  Sidebar: {
    Provider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Main: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Trigger: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  },
}))
vi.mock('@/components/base', () => ({
  Resizable: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Handle: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  }),
}))

vi.mock('./app-sidebar', () => ({
  AppSidebar: (props: SidebarCallbacks) => {
    sidebarCapture.props = props
    return null
  },
}))
vi.mock('./approval-toasts', () => ({ ApprovalToastRegion: () => null }))
vi.mock('./command-palette', () => ({ CommandPalette: () => null }))
vi.mock('./remote-status', () => ({ RemoteStatus: () => null }))
vi.mock('@/components/chat/changes-panel', () => ({ ChangesPanel: () => null }))
vi.mock('@/components/chat/chat-view', () => ({ ChatView: () => null }))
vi.mock('@/components/chat/empty-state', () => ({ EmptyState: () => null }))
vi.mock('@/components/settings', () => ({ default: () => null }))

function renderShell(overrides: Partial<ShellProps> = {}) {
  const props: ShellProps = {
    conversations: [],
    activeId: 'conversation-1',
    projects: [],
    activeProjectId: null,
    page: 'settings',
    settingsTab: 'provider',
    pendingDraft: null,
    headerTitle: 'Settings',
    canDragWindow: true,
    onSelect: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onSelectProject: vi.fn(),
    onCreateProject: vi.fn(),
    onCreateHostedSession: vi.fn().mockResolvedValue(null),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    onOpenSettings: vi.fn(),
    onCloseSettings: vi.fn(),
    onSettingsTabChange: vi.fn(),
    onCreateWithDraft: vi.fn().mockResolvedValue(undefined),
    onInitialDraftConsumed: vi.fn(),
    ...overrides,
  }
  render(<AppShell {...props} />)
  return props
}

async function invoke(action: () => unknown) {
  await act(async () => {
    await Promise.resolve(action())
    await Promise.resolve()
  })
}

describe('AppShell settings navigation guard', () => {
  beforeEach(() => {
    confirmMocks.confirm.mockReset()
    sidebarCapture.props = null
    clearSettingsTabDirty('provider')
    clearSettingsTabDirty('general')
  })

  afterEach(() => {
    clearSettingsTabDirty('provider')
    clearSettingsTabDirty('general')
  })

  it.each([
    ['change tab', (props: SidebarCallbacks) => props.onSettingsTabChange('general'), 'onSettingsTabChange'],
    ['close settings', (props: SidebarCallbacks) => props.onCloseSettings(), 'onCloseSettings'],
    ['select a conversation', (props: SidebarCallbacks) => props.onSelect('conversation-2'), 'onSelect'],
    ['create a conversation', (props: SidebarCallbacks) => props.onCreate(), 'onCreate'],
  ] as const)('does not %s when leaving a dirty tab is cancelled', async (_label, action, callback) => {
    setSettingsTabDirty('provider', 'editor', true)
    confirmMocks.confirm.mockResolvedValue(false)
    const props = renderShell()

    await invoke(() => action(sidebarCapture.props!))

    await waitFor(() => expect(confirmMocks.confirm).toHaveBeenCalledTimes(1))
    expect(props[callback]).not.toHaveBeenCalled()
    expect(isSettingsTabDirty('provider')).toBe(true)
  })

  it('clears only the tab being left after confirmation', async () => {
    setSettingsTabDirty('provider', 'provider-editor', true)
    setSettingsTabDirty('general', 'general-editor', true)
    confirmMocks.confirm.mockResolvedValue(true)
    const props = renderShell()

    await invoke(() => sidebarCapture.props!.onSettingsTabChange('general'))

    await waitFor(() => expect(props.onSettingsTabChange).toHaveBeenCalledWith('general'))
    expect(isSettingsTabDirty('provider')).toBe(false)
    expect(isSettingsTabDirty('general')).toBe(true)
  })

  it('keeps the tab dirty when creation fails and asks again on the next leave attempt', async () => {
    setSettingsTabDirty('provider', 'editor', true)
    confirmMocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const createError = new Error('create failed')
    const props = renderShell({ onCreate: vi.fn().mockRejectedValue(createError) })

    await invoke(() => sidebarCapture.props!.onCreate())

    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1))
    expect(isSettingsTabDirty('provider')).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent('sidebar.createConversationFailed')

    await invoke(() => sidebarCapture.props!.onCloseSettings())

    await waitFor(() => expect(confirmMocks.confirm).toHaveBeenCalledTimes(2))
    expect(props.onCloseSettings).not.toHaveBeenCalled()
    expect(isSettingsTabDirty('provider')).toBe(true)
  })
})

it('uses the skip link as a focus move without changing the hash', () => {
  window.history.replaceState(null, '', '/#playground/navigation')
  renderShell({ page: 'chat' })
  const skipLink = screen.getByRole('link', { name: 'app.skipToContent' })
  const main = document.getElementById('main-content')
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })

  act(() => {
    skipLink.dispatchEvent(click)
  })

  expect(click.defaultPrevented).toBe(true)
  expect(window.location.hash).toBe('#playground/navigation')
  expect(main).toHaveFocus()
})
