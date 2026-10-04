import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
import { api } from '@/api'
import type { AcpConfigOptionInfoResponse, ProviderInfoResponse } from '@/types'
import { HostedModelPanel, ModelPanel, type ModelPanelProps } from './model-panel'

vi.mock('@/api', () => ({
  api: { fetchProviderModels: vi.fn() },
}))
const mockApi = vi.mocked(api)

const provider = (id: string, name: string) =>
  ({
    id,
    name,
    is_enabled: true,
    icon: null,
    catalog_id: null,
    provider_type: 'openai',
  }) as unknown as ProviderInfoResponse
const ONE = provider('p1', 'One')
const TWO = provider('p2', 'Two')

function props(over: Partial<ModelPanelProps> = {}): ModelPanelProps {
  return {
    assistants: [],
    providers: [ONE, TWO],
    currentAssistantId: null,
    currentModelId: 'alpha',
    currentProviderId: 'p1',
    onSelectAssistant: vi.fn(),
    onSelectModel: vi.fn(),
    thinkingLevel: 'default',
    onSelectThinkingLevel: vi.fn(),
    fastMode: false,
    onToggleFast: vi.fn(),
    capabilities: null,
    ...over,
  }
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Model and thinking/ }))
  return screen.findByRole('dialog', { name: 'Model and thinking' })
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.fetchProviderModels.mockImplementation(async ({ providerId }) =>
    providerId === 'p1'
      ? [
          { id: 'alpha', name: 'Alpha' },
          { id: 'beta', name: 'Beta' },
        ]
      : [{ id: 'gamma', name: 'Gamma' }],
  )
})

describe('ModelPanel', () => {
  it('names the model on its trigger, and the effort only off its default', () => {
    const { unmount } = render(<ModelPanel {...props()} />)
    expect(screen.getByRole('button', { name: 'Model and thinking: alpha' })).toBeInTheDocument()
    unmount()
    render(<ModelPanel {...props({ thinkingLevel: 'high' })} />)
    expect(screen.getByRole('button', { name: 'Model and thinking: alpha · High' })).toBeInTheDocument()
  })

  it("opens on the current provider's models and switches provider from the rail", async () => {
    const user = userEvent.setup()
    render(<ModelPanel {...props()} />)
    const dialog = await openPanel(user)
    const list = await within(dialog).findByRole('grid', { name: 'Models' })
    await within(list).findByText('Alpha')
    expect(within(list).queryByText('Gamma')).toBeNull()

    await user.click(within(dialog).getByRole('option', { name: 'Two' }))
    expect(await within(list).findByText('Gamma')).toBeInTheDocument()
  })

  it('chooses a model and stays open, so its effort can be set next', async () => {
    const user = userEvent.setup()
    const onSelectModel = vi.fn()
    render(<ModelPanel {...props({ onSelectModel })} />)
    const dialog = await openPanel(user)
    await user.click(await within(dialog).findByText('Beta'))
    expect(onSelectModel).toHaveBeenCalledWith('beta', 'p1')
    expect(screen.getByRole('dialog', { name: 'Model and thinking' })).toBeInTheDocument()
  })

  it('searches every provider, naming the provider beside each result', async () => {
    const user = userEvent.setup()
    render(<ModelPanel {...props()} />)
    const dialog = await openPanel(user)
    await within(dialog).findByText('Alpha')
    await user.type(within(dialog).getByRole('searchbox', { name: 'Search models' }), 'gam')
    const list = within(dialog).getByRole('grid', { name: 'Models' })
    expect(within(list).getByRole('row', { name: /Gamma Two/ })).toBeInTheDocument()
    expect(within(list).queryByText('Alpha')).toBeNull()
  })

  it('jumps to the search with "/" from the list, and never from the field itself', async () => {
    const user = userEvent.setup()
    render(<ModelPanel {...props()} />)
    const dialog = await openPanel(user)
    const row = await within(dialog).findByRole('row', { name: 'Alpha' })
    row.focus()
    await user.keyboard('/')
    expect(within(dialog).getByRole('searchbox', { name: 'Search models' })).toHaveFocus()
  })

  it("puts the effort on the selected model's row, offering only what the model supports", async () => {
    const user = userEvent.setup()
    const onSelectThinkingLevel = vi.fn()
    render(
      <ModelPanel
        {...props({
          thinkingLevel: 'high',
          onSelectThinkingLevel,
          capabilities: { supports_thinking_off: false, supported_efforts: ['low', 'high'] } as never,
        })}
      />,
    )
    const dialog = await openPanel(user)
    const selected = await within(dialog).findByRole('row', { name: 'Alpha' })
    await user.click(within(selected).getByRole('button', { name: 'Thinking: High' }))
    const levels = await screen.findByRole('listbox', { name: 'Thinking' })
    const names = within(levels)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names.some((n) => n?.startsWith('Off'))).toBe(false)
    await user.click(within(levels).getByRole('option', { name: /^Low/ }))
    expect(onSelectThinkingLevel).toHaveBeenCalledWith('low')
  })

  it('offers fast mode only where the model has it', async () => {
    const user = userEvent.setup()
    const onToggleFast = vi.fn()
    const { unmount } = render(<ModelPanel {...props({ onToggleFast })} />)
    let dialog = await openPanel(user)
    expect(within(dialog).queryByRole('switch')).toBeNull()
    unmount()

    render(<ModelPanel {...props({ onToggleFast, capabilities: { supports_fast: true } as never })} />)
    dialog = await openPanel(user)
    await user.click(within(dialog).getByRole('switch', { name: 'Fast' }))
    expect(onToggleFast).toHaveBeenCalledWith(true)
  })

  it('fetches once when the answer is empty, instead of fetching for ever', async () => {
    const user = userEvent.setup()
    mockApi.fetchProviderModels.mockResolvedValue([])
    render(<ModelPanel {...props({ providers: [ONE] })} />)
    const dialog = await openPanel(user)
    expect(await within(dialog).findByText(i18n.t('toolbar.noModels'))).toBeInTheDocument()
    // Give a re-running effect every chance to fire again.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockApi.fetchProviderModels).toHaveBeenCalledTimes(1)
  })

  it('says the list failed to load, and why, rather than that there are no models', async () => {
    const user = userEvent.setup()
    mockApi.fetchProviderModels.mockRejectedValue(new Error('offline'))
    render(<ModelPanel {...props({ providers: [ONE] })} />)
    const dialog = await openPanel(user)
    expect(
      await within(dialog).findByText(i18n.t('toolbar.modelsLoadFailedReason', { error: 'One: offline' })),
    ).toBeInTheDocument()
  })
})

describe('HostedModelPanel', () => {
  const model: AcpConfigOptionInfoResponse = {
    id: 'model',
    name: 'Model',
    description: null,
    category: 'model',
    type: 'select',
    currentValue: 'opus',
    options: [
      { value: 'opus', name: 'Opus', description: null },
      { value: 'sonnet', name: 'Sonnet', description: null },
    ],
  }
  const effort: AcpConfigOptionInfoResponse = {
    id: 'effort',
    name: 'Effort',
    description: null,
    category: 'thought_level',
    type: 'select',
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Default', description: null },
      { value: 'high', name: 'High', description: null },
    ],
  }

  it("lists the agent's models and sets one over ACP", async () => {
    const user = userEvent.setup()
    const onSet = vi.fn()
    render(<HostedModelPanel model={model} effort={effort} onSet={onSet} />)
    await user.click(screen.getByRole('button', { name: /Opus/ }))
    const dialog = await screen.findByRole('dialog')
    // No provider rail and no search: the agent offers one short list.
    expect(within(dialog).queryByRole('listbox', { name: 'Providers' })).toBeNull()
    expect(within(dialog).queryByRole('searchbox')).toBeNull()
    await user.click(within(dialog).getByText('Sonnet'))
    expect(onSet).toHaveBeenCalledWith('model', 'sonnet')
  })

  it('is not drawn when the agent offers neither knob', () => {
    const { container } = render(<HostedModelPanel onSet={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('waits while the agent is applying a change', () => {
    render(<HostedModelPanel model={model} busy onSet={() => {}} />)
    expect(screen.getByRole('button', { name: /Opus/ })).toBeDisabled()
  })
})

describe('the panel reopened', () => {
  it('fetches again after an empty answer', async () => {
    const user = userEvent.setup()
    mockApi.fetchProviderModels.mockResolvedValue([])
    render(<ModelPanel {...props({ providers: [ONE] })} />)
    await openPanel(user)
    await waitFor(() => expect(mockApi.fetchProviderModels).toHaveBeenCalledTimes(1))
    await user.keyboard('{Escape}')
    await openPanel(user)
    await waitFor(() => expect(mockApi.fetchProviderModels).toHaveBeenCalledTimes(2))
  })
})
