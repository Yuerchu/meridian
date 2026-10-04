import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
import type { AcpConfigOptionInfoResponse, ChatMode } from '@/types'
import { HostedModeChip, ModeChip } from './mode-chip'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

function native(mode: ChatMode, acceptEdits: boolean) {
  const onSelectMode = vi.fn()
  const onToggleAcceptEdits = vi.fn()
  render(
    <ModeChip
      mode={mode}
      acceptEdits={acceptEdits}
      onSelectMode={onSelectMode}
      onToggleAcceptEdits={onToggleAcceptEdits}
    />,
  )
  return { onSelectMode, onToggleAcceptEdits }
}

async function choose(user: ReturnType<typeof userEvent.setup>, chip: RegExp, row: RegExp) {
  await user.click(screen.getByRole('button', { name: chip }))
  const menu = await screen.findByRole('menu')
  await user.click(within(menu).getByRole('menuitemradio', { name: row }))
}

describe('ModeChip', () => {
  it('names the current mode, out of the two settings it stands for', () => {
    native('work', false)
    expect(screen.getByRole('button', { name: 'Mode: Manual' })).toBeInTheDocument()
  })

  it('reads accept-edits as its own mode, and plan above both', () => {
    const { unmount } = render(
      <ModeChip mode="work" acceptEdits onSelectMode={() => {}} onToggleAcceptEdits={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Mode: Accept edits' })).toBeInTheDocument()
    unmount()
    render(<ModeChip mode="plan" acceptEdits onSelectMode={() => {}} onToggleAcceptEdits={() => {}} />)
    expect(screen.getByRole('button', { name: 'Mode: Plan' })).toBeInTheDocument()
  })

  it('lists the three modes with the current one checked', async () => {
    const user = userEvent.setup()
    native('work', true)
    await user.click(screen.getByRole('button', { name: /^Mode/ }))
    const menu = await screen.findByRole('menu')
    const radios = within(menu).getAllByRole('menuitemradio')
    expect(radios).toHaveLength(3)
    expect(radios.find((r) => r.getAttribute('aria-checked') === 'true')).toHaveTextContent('Accept edits')
  })

  it('leaving plan for manual changes the mode and nothing else', async () => {
    const user = userEvent.setup()
    const { onSelectMode, onToggleAcceptEdits } = native('plan', false)
    await choose(user, /^Mode/, /^Manual/)
    expect(onSelectMode).toHaveBeenCalledWith('work')
    expect(onToggleAcceptEdits).not.toHaveBeenCalled()
  })

  it('going from accept-edits to manual turns the standing yes off', async () => {
    const user = userEvent.setup()
    const { onSelectMode, onToggleAcceptEdits } = native('work', true)
    await choose(user, /^Mode/, /^Manual/)
    expect(onToggleAcceptEdits).toHaveBeenCalledWith(false)
    expect(onSelectMode).not.toHaveBeenCalled()
  })

  it('choosing plan leaves accept-edits as it was', async () => {
    const user = userEvent.setup()
    const { onSelectMode, onToggleAcceptEdits } = native('work', true)
    await choose(user, /^Mode/, /^Plan/)
    expect(onSelectMode).toHaveBeenCalledWith('plan')
    expect(onToggleAcceptEdits).not.toHaveBeenCalled()
  })
})

describe('HostedModeChip', () => {
  const option: AcpConfigOptionInfoResponse = {
    id: 'mode',
    name: 'Mode',
    description: null,
    category: 'mode',
    type: 'select',
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Default', description: 'Ask first' },
      { value: 'acceptEdits', name: 'Accept Edits', description: null },
      { value: 'plan', name: 'Plan', description: null },
    ],
  }

  it("offers the agent's own modes under their translated names and sets one over ACP", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<HostedModeChip option={option} onSelect={onSelect} />)
    const chip = screen.getByRole('button', {
      name: `${i18n.t('chat.acp.knob.mode')}: ${i18n.t('chat.acp.value.mode.default')}`,
    })
    await user.click(chip)
    const menu = await screen.findByRole('menu')
    await user.click(
      within(menu).getByRole('menuitemradio', { name: new RegExp(`^${i18n.t('chat.acp.value.mode.plan')}`) }),
    )
    expect(onSelect).toHaveBeenCalledWith('plan')
  })

  it('is disabled while the agent is changing a setting', () => {
    render(<HostedModeChip option={option} busy onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /^Permission mode/ })).toBeDisabled()
  })
})

describe('ModeChip, when one of its two writes is refused', () => {
  function chip(mode: ChatMode, acceptEdits: boolean, answers: { mode?: boolean; accept?: boolean }) {
    const onSelectMode = vi.fn(() => Promise.resolve(answers.mode ?? true))
    const onToggleAcceptEdits = vi.fn(() => Promise.resolve(answers.accept ?? true))
    render(
      <ModeChip
        mode={mode}
        acceptEdits={acceptEdits}
        onSelectMode={onSelectMode}
        onToggleAcceptEdits={onToggleAcceptEdits}
      />,
    )
    return { onSelectMode, onToggleAcceptEdits }
  }

  it('turns the standing yes on only once the mode has moved', async () => {
    const user = userEvent.setup()
    const { onSelectMode, onToggleAcceptEdits } = chip('plan', false, {})
    await choose(user, /^Mode/, /^Accept edits/)
    await waitFor(() => expect(onToggleAcceptEdits).toHaveBeenCalledWith(true))
    expect(onSelectMode.mock.invocationCallOrder[0]).toBeLessThan(onToggleAcceptEdits.mock.invocationCallOrder[0])
  })

  it('leaves edits asking when the mode change from plan is refused', async () => {
    const user = userEvent.setup()
    const { onSelectMode, onToggleAcceptEdits } = chip('plan', false, { mode: false })
    await choose(user, /^Mode/, /^Accept edits/)
    await waitFor(() => expect(onSelectMode).toHaveBeenCalledWith('work'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onToggleAcceptEdits).not.toHaveBeenCalled()
  })

  it('turns the standing yes off before moving the mode, and stays put if that is refused', async () => {
    const user = userEvent.setup()
    const { onSelectMode, onToggleAcceptEdits } = chip('plan', true, { accept: false })
    await choose(user, /^Mode/, /^Manual/)
    await waitFor(() => expect(onToggleAcceptEdits).toHaveBeenCalledWith(false))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onSelectMode).not.toHaveBeenCalled()
  })
})
