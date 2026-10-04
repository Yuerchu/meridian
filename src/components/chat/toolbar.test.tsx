import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobileOptionsMenu, type MobileOptionsMenuProps } from './toolbar'
import i18n from '@/i18n'

vi.mock('@/api', () => ({
  api: { fetchProviderModels: vi.fn().mockResolvedValue([]) },
}))

function props(over: Partial<MobileOptionsMenuProps> = {}): MobileOptionsMenuProps {
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
    capabilities: null,
    onTakePhoto: vi.fn(),
    onPickGallery: vi.fn(),
    supportsImages: true,
    ...over,
  }
}

describe('MobileOptionsMenu', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('lists its rows as a menu, the booleans as checkbox rows', async () => {
    const user = userEvent.setup()
    const onToggleFast = vi.fn()
    render(<MobileOptionsMenu {...props({ onToggleFast, capabilities: { supports_fast: true } as never })} />)
    await user.click(screen.getByRole('button', { name: 'Options and attachments' }))

    const menu = await screen.findByRole('menu', { name: 'Options and attachments' })
    expect(within(menu).getByRole('menuitem', { name: /Take Photo|Camera/i })).toBeInTheDocument()
    // The permission mode is a chip on the toolbar now, not a row here.
    expect(within(menu).queryByRole('menuitem', { name: /^Mode/ })).toBeNull()
    expect(within(menu).queryByRole('menuitemcheckbox', { name: /Accept edits/ })).toBeNull()
    const fast = within(menu).getByRole('menuitemcheckbox', { name: /Fast/ })
    await user.click(fast)
    expect(onToggleFast).toHaveBeenCalledWith(true)
  })

  it('opens stickers from a row of its own', async () => {
    const user = userEvent.setup()
    const onOpenStickers = vi.fn()
    render(<MobileOptionsMenu {...props({ onOpenStickers })} />)
    await user.click(screen.getByRole('button', { name: 'Options and attachments' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Emoji' }))
    expect(onOpenStickers).toHaveBeenCalled()
  })

  it('opens a panel whose choices are radio rows with the current one checked', async () => {
    const user = userEvent.setup()
    const onSelectThinkingLevel = vi.fn()
    render(<MobileOptionsMenu {...props({ thinkingLevel: 'high', onSelectThinkingLevel })} />)
    await user.click(screen.getByRole('button', { name: 'Options and attachments' }))
    await user.click(await screen.findByRole('menuitem', { name: /Thinking/ }))

    const panel = await screen.findByRole('menu', { name: 'Thinking' })
    expect(within(panel).getByRole('menuitemradio', { name: /^High/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(panel).getByRole('menuitemradio', { name: /^Default/ }))
    expect(onSelectThinkingLevel).toHaveBeenCalledWith('default')
  })
})
