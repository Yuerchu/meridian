import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { ConversationInfoResponse, ProjectInfoResponse } from '@/types'
import { CommandPalette } from './command-palette'

vi.mock('@/api', () => ({ api: { searchConversations: vi.fn() } }))
vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))

const mockApi = vi.mocked(api)

const conv = (id: string, title: string) => ({ id, title, is_archived: false }) as ConversationInfoResponse

function setup() {
  const handlers = {
    onOpenChange: vi.fn(),
    onSelectConversation: vi.fn(),
    onSelectProject: vi.fn(),
    onOpenSettingsTab: vi.fn(),
    onCreate: vi.fn(),
  }
  render(
    <CommandPalette
      isOpen
      conversations={[conv('c1', 'Quarterly report'), conv('c2', 'Trip to Kyoto')]}
      projects={[{ id: 'p1', name: 'Atlas', source_type: 'local' } as unknown as ProjectInfoResponse]}
      {...handlers}
    />,
  )
  return { user: userEvent.setup(), ...handlers }
}

describe('CommandPalette', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.searchConversations.mockResolvedValue([])
  })

  it('filters what is in memory by what is typed, and opens the one chosen', async () => {
    const { user, onSelectConversation, onOpenChange } = setup()
    expect(await screen.findByRole('menuitem', { name: 'Quarterly report' })).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox'), 'kyoto')
    expect(screen.queryByRole('menuitem', { name: 'Quarterly report' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Trip to Kyoto' }))
    expect(onSelectConversation).toHaveBeenCalledWith('c2')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('finds a settings section by the word "settings"', async () => {
    const { user, onOpenSettingsTab } = setup()
    await user.type(await screen.findByRole('searchbox'), 'settings')
    const items = await screen.findAllByRole('menuitem')
    expect(items.length).toBeGreaterThan(0)
    await user.click(items[0])
    expect(onOpenSettingsTab).toHaveBeenCalledTimes(1)
  })

  it('adds what the transcripts say from the backend, shown as it came', async () => {
    mockApi.searchConversations.mockResolvedValue([
      { conversation_id: 'c9', title: 'Old chat', snippet: 'the zebra crossing' },
    ] as never)
    const { user, onSelectConversation } = setup()
    await user.type(await screen.findByRole('searchbox'), 'zebra')

    const hit = await screen.findByRole('menuitem', { name: 'Old chat' })
    await waitFor(() => expect(mockApi.searchConversations).toHaveBeenCalledWith({ query: 'zebra', limit: null }))
    expect(hit).toHaveAccessibleDescription('the zebra crossing')
    await user.click(hit)
    expect(onSelectConversation).toHaveBeenCalledWith('c9')
  })

  it('starts a conversation from the actions group', async () => {
    const { user, onCreate } = setup()
    await user.click(await screen.findByRole('menuitem', { name: i18n.t('sidebar.newChat') }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})
