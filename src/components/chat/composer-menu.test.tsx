import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerMenu, type ComposerMenuProps } from './composer-menu'
import i18n from '@/i18n'
import { api } from '@/api'

vi.mock('@/api', () => ({
  api: { fetchProviderModels: vi.fn() },
}))

const mockApi = vi.mocked(api)

function props(over: Partial<ComposerMenuProps> = {}): ComposerMenuProps {
  return {
    assistants: [],
    providers: [],
    currentAssistantId: null,
    currentModelId: null,
    currentProviderId: null,
    onSelectAssistant: vi.fn(),
    onSelectModel: vi.fn(),
    thinkingLevel: 'default',
    onSelectThinkingLevel: vi.fn(),
    fastMode: false,
    onToggleFast: vi.fn(),
    mode: 'work',
    onSelectMode: vi.fn(),
    acceptEdits: false,
    onToggleAcceptEdits: vi.fn(),
    capabilities: null,
    ...over,
  }
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Options and attachments' }))
  return screen.findByRole('menu', { name: 'Options and attachments' })
}

/** The second menu on screen: a submenu is its own `role="menu"`, labelled by its row. */
async function findSubmenu() {
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2))
  return screen.getAllByRole('menu')[1]
}

describe('ComposerMenu', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.fetchProviderModels.mockResolvedValue([])
  })

  it('is a menu whose value rows open a submenu of radio choices', async () => {
    const user = userEvent.setup()
    const onSelectThinkingLevel = vi.fn()
    render(<ComposerMenu {...props({ thinkingLevel: 'high', onSelectThinkingLevel })} />)
    const menu = await openMenu(user)

    const row = within(menu).getByRole('menuitem', { name: /Thinking/ })
    expect(row).toHaveAttribute('aria-haspopup', 'menu')
    await user.click(row)

    const submenu = await findSubmenu()
    const radios = within(submenu).getAllByRole('menuitemradio')
    expect(radios.find((r) => r.getAttribute('aria-checked') === 'true')).toHaveTextContent('High')

    await user.click(within(submenu).getByRole('menuitemradio', { name: /Default/ }))
    expect(onSelectThinkingLevel).toHaveBeenCalledWith('default')
  })

  it('reaches the submenu and back with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<ComposerMenu {...props({ mode: 'plan' })} />)
    await openMenu(user)

    const modeRow = screen.getByRole('menuitem', { name: /^Mode(?!ls)/ })
    modeRow.focus()
    await user.keyboard('{ArrowRight}')
    const submenu = await findSubmenu()
    await waitFor(() => expect(submenu.contains(document.activeElement)).toBe(true))
    expect(within(submenu).getByRole('menuitemradio', { name: /Plan/ })).toHaveAttribute('aria-checked', 'true')

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1))
    expect(document.activeElement).toBe(modeRow)
  })

  it('draws the booleans as checkbox rows that toggle', async () => {
    const user = userEvent.setup()
    const onToggleAcceptEdits = vi.fn()
    render(
      <ComposerMenu
        {...props({ acceptEdits: true, onToggleAcceptEdits, capabilities: { supports_fast: true } as never })}
      />,
    )
    await openMenu(user)

    const accept = screen.getByRole('menuitemcheckbox', { name: /Accept edits/ })
    expect(accept).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: /Fast/ })).toHaveAttribute('aria-checked', 'false')

    await user.click(accept)
    expect(onToggleAcceptEdits).toHaveBeenCalledWith(false)
  })

  it('does not offer accept-edits in plan mode', async () => {
    const user = userEvent.setup()
    render(<ComposerMenu {...props({ mode: 'plan' })} />)
    await openMenu(user)
    expect(screen.queryByRole('menuitemcheckbox', { name: /Accept edits/ })).not.toBeInTheDocument()
  })

  describe('the model submenu', () => {
    const provider = { id: 'p1', name: 'One', is_enabled: true } as never

    it('fetches once when the answer is empty, instead of fetching for ever', async () => {
      const user = userEvent.setup()
      render(<ComposerMenu {...props({ providers: [provider] })} />)
      const menu = await openMenu(user)
      await user.click(within(menu).getByRole('menuitem', { name: /Model/ }))

      const submenu = await findSubmenu()
      expect(await within(submenu).findByText(i18n.t('toolbar.noModels'))).toBeInTheDocument()
      // Give a re-running effect every chance to fire again.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(mockApi.fetchProviderModels).toHaveBeenCalledTimes(1)
    })

    it('says the list failed to load, and why, rather than that there are no models', async () => {
      const user = userEvent.setup()
      mockApi.fetchProviderModels.mockRejectedValue(new Error('offline'))
      render(<ComposerMenu {...props({ providers: [provider] })} />)
      const menu = await openMenu(user)
      await user.click(within(menu).getByRole('menuitem', { name: /Model/ }))

      const submenu = await findSubmenu()
      // The provider that refused and its own words, not a generic sentence
      // that leaves the reason in the log.
      expect(
        await within(submenu).findByText(i18n.t('toolbar.modelsLoadFailedReason', { error: 'One: offline' })),
      ).toBeInTheDocument()
      expect(mockApi.fetchProviderModels).toHaveBeenCalledTimes(1)
    })
  })
})
