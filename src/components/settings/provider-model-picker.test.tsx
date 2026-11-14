import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
import { ProviderModelPicker } from './provider-model-picker'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

it.each(['label', 'aria'] as const)('commits the %s-labelled fallback only on blur', async (labelMode) => {
  const user = userEvent.setup()
  const commit = vi.fn()
  function Harness() {
    const [model, setModel] = useState('')
    return (
      <ProviderModelPicker
        providers={[]}
        models={[]}
        providerId="p1"
        modelId={model}
        onChange={(_, next) => setModel(next)}
        onCommit={commit}
        emptyProviderLabel="Default"
        labelMode={labelMode}
      />
    )
  }
  render(<Harness />)
  const input = screen.getByRole('textbox', { name: i18n.t('settings.assistant.model') })
  await user.type(input, 'custom-model')
  expect(input).toHaveValue('custom-model')
  expect(commit).not.toHaveBeenCalled()
  await user.tab()
  expect(commit).toHaveBeenCalledExactlyOnceWith('p1', 'custom-model')
})

it('disables the fallback when a provider is required but absent', () => {
  render(
    <ProviderModelPicker
      providers={[]}
      models={[]}
      providerId=""
      modelId=""
      onChange={vi.fn()}
      emptyProviderLabel="Default"
      isModelDisabledWithoutProvider
    />,
  )
  expect(screen.getByRole('textbox', { name: i18n.t('settings.assistant.model') })).toBeDisabled()
})
