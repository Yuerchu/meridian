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

  async function openEffort(user: ReturnType<typeof userEvent.setup>, chipName: string) {
    const dialog = await openPanel(user)
    const selected = await within(dialog).findByRole('row', { name: 'Alpha' })
    await user.click(within(selected).getByRole('button', { name: chipName }))
    return screen.findByRole('dialog', { name: 'Thinking' })
  }

  it("puts the effort on the selected model's row as a slider over only the levels the model has", async () => {
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
    const effort = await openEffort(user, 'Thinking: High')
    const slider = within(effort).getByRole('slider', { name: 'Thinking' })
    // Two stops — low and high; no off, which this model refuses.
    expect(slider).toHaveAttribute('max', '1')
    expect(slider).toHaveValue('1')
    slider.focus()
    await user.keyboard('{ArrowLeft}')
    expect(onSelectThinkingLevel).toHaveBeenCalledWith('low')
  })

  it('makes following the assistant a switch, with the slider waiting under it', async () => {
    const user = userEvent.setup()
    const onSelectThinkingLevel = vi.fn()
    render(<ModelPanel {...props({ thinkingLevel: 'default', onSelectThinkingLevel })} />)
    const effort = await openEffort(user, 'Thinking: Default')
    const follow = within(effort).getByRole('switch', { name: 'Follow assistant' })
    expect(follow).toBeChecked()
    expect(within(effort).getByRole('slider', { name: 'Thinking' })).toBeDisabled()

    await user.click(follow)
    // Off the default, it lands on a level of its own — the middle one with
    // nothing chosen before — never on "default" again.
    expect(onSelectThinkingLevel).toHaveBeenCalledTimes(1)
    expect(onSelectThinkingLevel.mock.calls[0][0]).not.toBe('default')
  })

  // The capabilities can land after the popover opened. The level remembered
  // against the longer fallback list must not point past the real one — the
  // switch would write `default` back and do nothing.
  it('keeps where the switch lands in range when the levels shrink after opening', async () => {
    const user = userEvent.setup()
    const onSelectThinkingLevel = vi.fn()
    const { rerender } = render(<ModelPanel {...props({ thinkingLevel: 'default', onSelectThinkingLevel })} />)
    const effort = await openEffort(user, 'Thinking: Default')
    rerender(
      <ModelPanel
        {...props({
          thinkingLevel: 'default',
          onSelectThinkingLevel,
          capabilities: { supports_thinking_off: false, supported_efforts: ['low', 'high'] } as never,
        })}
      />,
    )
    const slider = within(effort).getByRole('slider', { name: 'Thinking' })
    expect(slider).toHaveAttribute('max', '1')
    expect(Number((slider as HTMLInputElement).value)).toBeLessThanOrEqual(1)

    await user.click(within(effort).getByRole('switch', { name: 'Follow assistant' }))
    expect(onSelectThinkingLevel).toHaveBeenCalledTimes(1)
    expect(['low', 'high']).toContain(onSelectThinkingLevel.mock.calls[0][0])
  })

  it('offers the maximum level to a model that advertises it', async () => {
    const user = userEvent.setup()
    render(
      <ModelPanel
        {...props({
          thinkingLevel: 'max',
          capabilities: { supports_thinking_off: false, supported_efforts: ['high', 'max'] } as never,
        })}
      />,
    )
    const effort = await openEffort(user, 'Thinking: Max')
    const slider = within(effort).getByRole('slider', { name: 'Thinking' })
    expect(slider).toHaveAttribute('max', '1')
    expect(slider).toHaveValue('1')
  })

  it('turns the switch on to follow the assistant again', async () => {
    const user = userEvent.setup()
    const onSelectThinkingLevel = vi.fn()
    render(<ModelPanel {...props({ thinkingLevel: 'high', onSelectThinkingLevel })} />)
    const effort = await openEffort(user, 'Thinking: High')
    await user.click(within(effort).getByRole('switch', { name: 'Follow assistant' }))
    expect(onSelectThinkingLevel).toHaveBeenCalledWith('default')
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

  it('shows the effort itself when the agent offers no model to hang it on', async () => {
    const user = userEvent.setup()
    const onSet = vi.fn()
    render(<HostedModelPanel effort={effort} onSet={onSet} />)
    await user.click(screen.getByRole('button'))
    const dialog = await screen.findByRole('dialog')
    // One level beside the default: no slider to drag, only the switch.
    expect(within(dialog).queryByRole('slider')).toBeNull()
    await user.click(within(dialog).getByRole('switch', { name: 'Use default' }))
    expect(onSet).toHaveBeenCalledWith('effort', 'high')
  })

  it('lists the effort itself when the current model is not one the agent lists', async () => {
    const user = userEvent.setup()
    render(<HostedModelPanel model={{ ...model, currentValue: 'unlisted' }} effort={effort} onSet={() => {}} />)
    await user.click(screen.getByRole('button'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('switch', { name: 'Use default' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: new RegExp(`^${i18n.t('chat.acp.knob.effort')}`) })).toBeNull()
  })

  it('keeps the effort on the selected row when there is one', async () => {
    const user = userEvent.setup()
    render(<HostedModelPanel model={model} effort={effort} onSet={() => {}} />)
    await user.click(screen.getByRole('button', { name: /Opus/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('[data-slot="effort-slider"]')).toBeNull()
    expect(within(within(dialog).getByRole('row', { name: 'Opus' })).getByRole('button')).toBeInTheDocument()
  })

  it('is not drawn when the agent offers neither knob', () => {
    const { container } = render(<HostedModelPanel onSet={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  // A popover already open when a write starts: the chip's own disabling does
  // not reach inside it, so the slider and the switch have to wait too.
  it('holds the effort popover still while the agent applies a change', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<HostedModelPanel model={model} effort={effort} onSet={() => {}} />)
    await user.click(screen.getByRole('button', { name: /Opus/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(within(dialog).getByRole('row', { name: 'Opus' })).getByRole('button'))
    const switchControl = await screen.findByRole('switch', { name: 'Use default' })
    expect(switchControl).toBeEnabled()

    rerender(<HostedModelPanel model={model} effort={effort} busy onSet={() => {}} />)
    expect(screen.getByRole('switch', { name: 'Use default' })).toBeDisabled()
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

describe('providers that arrive after the panel opened', () => {
  it('fetches them instead of going on saying there are no models', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ModelPanel {...props({ providers: [] })} />)
    const dialog = await openPanel(user)
    expect(await within(dialog).findByText(i18n.t('toolbar.noModels'))).toBeInTheDocument()
    expect(mockApi.fetchProviderModels).not.toHaveBeenCalled()

    rerender(<ModelPanel {...props({ providers: [ONE] })} />)
    expect(await within(dialog).findByText('Alpha')).toBeInTheDocument()
    expect(mockApi.fetchProviderModels).toHaveBeenCalledTimes(1)
  })

  it('drops an answer for a provider list that has since changed', async () => {
    const user = userEvent.setup()
    let answerOne!: (models: { id: string; name: string }[]) => void
    mockApi.fetchProviderModels.mockImplementation(({ providerId }) =>
      providerId === 'p1'
        ? new Promise((resolve) => {
            answerOne = resolve
          })
        : Promise.resolve([{ id: 'gamma', name: 'Gamma' }]),
    )
    const { rerender } = render(<ModelPanel {...props({ providers: [ONE], currentProviderId: 'p2' })} />)
    const dialog = await openPanel(user)
    rerender(<ModelPanel {...props({ providers: [TWO], currentProviderId: 'p2' })} />)
    expect(await within(dialog).findByText('Gamma')).toBeInTheDocument()

    // The first list's answer lands late and must not replace the second's.
    answerOne([{ id: 'alpha', name: 'Alpha' }])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(within(dialog).getByText('Gamma')).toBeInTheDocument()
    expect(within(dialog).queryByText('Alpha')).toBeNull()
  })
})
