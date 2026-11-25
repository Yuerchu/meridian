import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import { ProviderIconPicker } from './icon-picker'

vi.mock('@lobehub/icons/es/features/providerEnum', () => ({
  ModelProvider: { openai: 'openai', anthropic: 'anthropic', ollama: 'ollama' },
}))

function setup(onChange = vi.fn(), value: string | null = null) {
  render(<ProviderIconPicker value={value} catalogId={null} providerType="openai" onChange={onChange} />)
  return { user: userEvent.setup(), onChange }
}

describe('ProviderIconPicker', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('chooses a mark from the drawer and closes it', async () => {
    const { user, onChange } = setup()
    await user.click(screen.getByRole('button', { name: /default|follow/i }))
    expect(await screen.findByRole('dialog', { name: i18n.t('settings.provider.iconChoose') })).toBeInTheDocument()

    await user.click(await screen.findByRole('option', { name: 'ollama' }))
    expect(onChange).toHaveBeenCalledWith('ollama')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('filters the marks by what is typed', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button'))
    await screen.findByRole('option', { name: 'openai' })
    await user.type(screen.getByRole('searchbox'), 'olla')
    expect(screen.queryByRole('option', { name: 'openai' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'ollama' })).toBeInTheDocument()
  })

  it('following the vendor reports null, not a name', async () => {
    const { user, onChange } = setup(vi.fn(), 'ollama')
    await user.click(screen.getByRole('button'))
    await user.click(await screen.findByRole('option', { name: i18n.t('settings.provider.iconDefault') }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
