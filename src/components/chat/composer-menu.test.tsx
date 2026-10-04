import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerMenu } from './composer-menu'
import i18n from '@/i18n'
import type { AcpConfigOptionInfoResponse } from '@/types'

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Options and attachments' }))
  return screen.findByRole('menu', { name: 'Options and attachments' })
}

const agentKnob: AcpConfigOptionInfoResponse = {
  id: 'agent',
  name: 'Agent',
  description: null,
  category: null,
  type: 'select',
  currentValue: 'general',
  options: [
    { value: 'general', name: 'General', description: null },
    { value: 'reviewer', name: 'Reviewer', description: 'Reads, does not write' },
  ],
}

describe('ComposerMenu', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('offers what can be added to the message', async () => {
    const user = userEvent.setup()
    const onPickFile = vi.fn()
    render(<ComposerMenu onPickFile={onPickFile} onOpenStickers={() => {}} />)
    const menu = await openMenu(user)
    expect(within(menu).getByRole('menuitem', { name: 'Emoji' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'Attach File' }))
    expect(onPickFile).toHaveBeenCalled()
  })

  it('no longer carries the model, the thinking level, the assistant, fast mode or the permission mode', async () => {
    const user = userEvent.setup()
    render(<ComposerMenu onPickFile={() => {}} />)
    const menu = await openMenu(user)
    for (const name of [/^Model/, /Thinking/, /Assistant/, /^Mode(?!l)/]) {
      expect(within(menu).queryByRole('menuitem', { name })).toBeNull()
    }
    expect(within(menu).queryByRole('menuitemcheckbox')).toBeNull()
  })

  it('offers stickers only when given a way to open them', async () => {
    const user = userEvent.setup()
    const onOpenStickers = vi.fn()
    const { unmount } = render(<ComposerMenu onPickFile={() => {}} />)
    await openMenu(user)
    expect(screen.queryByRole('menuitem', { name: 'Emoji' })).toBeNull()
    unmount()

    render(<ComposerMenu onOpenStickers={onOpenStickers} />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Emoji' }))
    expect(onOpenStickers).toHaveBeenCalled()
  })

  it('draws an agent knob as a submenu of its values, ArrowRight in', async () => {
    const user = userEvent.setup()
    const onSetKnob = vi.fn()
    render(<ComposerMenu knobs={[agentKnob]} onSetKnob={onSetKnob} />)
    await openMenu(user)

    const row = screen.getByRole('menuitem', { name: /Agent/ })
    expect(row).toHaveAttribute('aria-haspopup', 'menu')
    row.focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2))
    const submenu = screen.getAllByRole('menu')[1]
    expect(within(submenu).getByRole('menuitemradio', { name: /^General/ })).toHaveAttribute('aria-checked', 'true')

    await user.click(within(submenu).getByRole('menuitemradio', { name: /^Reviewer/ }))
    expect(onSetKnob).toHaveBeenCalledWith('agent', 'reviewer')
  })

  it('is not drawn at all with nothing to offer', () => {
    const { container } = render(<ComposerMenu />)
    expect(container).toBeEmptyDOMElement()
  })
})
