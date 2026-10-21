import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocalModelSettings } from './local-model-settings'
import { SettingsCard } from '../primitives'
import { api } from '@/api'
import i18n from '@/i18n'
import { demoLocalModel } from '@/dev/demo/local-model'
import type { LocalInferenceBackend, LocalModelInfoResponse } from '@/types'

const connection = vi.hoisted(() => ({ remote: false }))
vi.mock('@/lib/transport', async (original) => ({
  ...(await original<typeof import('@/lib/transport')>()),
  get isRemote() {
    return connection.remote
  },
}))
vi.mock('@/api', () => ({ api: { inspectLocalModel: vi.fn(), getProviderLocalModelInfo: vi.fn() } }))
const mocked = vi.mocked(api)
const path = 'C:/Models/custom-12b-gpu.litertlm'

function panel(modelPath = path, backend: LocalInferenceBackend = 'gpu', onChange = vi.fn()) {
  return (
    <SettingsCard>
      <LocalModelSettings
        key={`${modelPath}:${backend}`}
        providerId="p1"
        modelPath={modelPath}
        backend={backend}
        onBackendChange={onChange}
      />
    </SettingsCard>
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  connection.remote = false
  await i18n.changeLanguage('zh-CN')
  mocked.inspectLocalModel.mockResolvedValue(demoLocalModel(path, 'gpu'))
})

it('inspects the chosen file and reports a backend without claiming hardware validation', async () => {
  const user = userEvent.setup()
  render(panel())
  await user.click(screen.getByRole('button', { name: i18n.t('settings.localModel.inspect') }))
  expect(mocked.inspectLocalModel).toHaveBeenCalledWith({ modelPath: path, backend: 'gpu', forceRefresh: true })
  expect(await screen.findByText('custom-12b-gpu.litertlm')).toBeInTheDocument()
  expect(screen.getByText(i18n.t('settings.localModel.notInitialized'))).toBeInTheDocument()
  expect(screen.getByText(i18n.t('settings.localModel.identity'))).toBeInTheDocument()
  expect(screen.getAllByText(i18n.t('settings.localModel.unavailable')).length).toBeGreaterThan(0)
  expect(screen.getByText(i18n.t('settings.localModel.notDeclared'))).toBeInTheDocument()
})

it('backend selection is returned to the provider draft, not saved through a separate command', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(panel(path, 'auto', onChange))
  await user.click(screen.getByRole('button', { name: new RegExp(i18n.t('settings.localModel.backend')) }))
  await user.click(await screen.findByRole('option', { name: 'NPU' }))
  expect(onChange).toHaveBeenCalledWith('npu')
  expect(mocked.inspectLocalModel).not.toHaveBeenCalled()
})

it('an inspection error is shown and never retried with CPU', async () => {
  const user = userEvent.setup()
  mocked.inspectLocalModel.mockRejectedValueOnce('code=14: GPU unavailable')
  render(panel())
  await user.click(screen.getByRole('button', { name: i18n.t('settings.localModel.inspect') }))
  expect(await screen.findByRole('alert')).toHaveTextContent('GPU unavailable')
  expect(mocked.inspectLocalModel).toHaveBeenCalledTimes(1)
  expect(mocked.inspectLocalModel.mock.calls[0][0].backend).toBe('gpu')
})

it('a slower result from an old file cannot overwrite a newer file', async () => {
  const user = userEvent.setup()
  let first: (value: LocalModelInfoResponse) => void = () => {
    throw new Error('first inspection did not start')
  }
  mocked.inspectLocalModel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        first = resolve
      }),
  )
  const { rerender } = render(panel())
  await user.click(screen.getByRole('button', { name: i18n.t('settings.localModel.inspect') }))
  const secondPath = 'C:/Models/second.litertlm'
  mocked.inspectLocalModel.mockResolvedValueOnce(demoLocalModel(secondPath, 'gpu'))
  rerender(panel(secondPath))
  await user.click(screen.getByRole('button', { name: i18n.t('settings.localModel.inspect') }))
  await screen.findByText('second.litertlm')
  await act(async () => {
    first(demoLocalModel(path, 'gpu'))
  })
  expect(screen.queryByText('custom-12b-gpu.litertlm')).not.toBeInTheDocument()
  expect(screen.getByText('second.litertlm')).toBeInTheDocument()
})

it('remote inspection uses only the saved provider ID and keeps hardware selection read-only', async () => {
  const user = userEvent.setup()
  connection.remote = true
  mocked.getProviderLocalModelInfo.mockResolvedValue(demoLocalModel(path, 'auto'))
  render(panel(path, 'auto'))
  expect(screen.getByRole('button', { name: new RegExp(i18n.t('settings.localModel.backend')) })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: i18n.t('settings.localModel.inspect') }))
  await screen.findByText('custom-12b-gpu.litertlm')
  expect(mocked.getProviderLocalModelInfo).toHaveBeenCalledWith({ providerId: 'p1', forceRefresh: true })
  expect(mocked.inspectLocalModel).not.toHaveBeenCalled()
})

it('NPU vendor and target SoC are shown separately from the backend', async () => {
  const user = userEvent.setup()
  const info = demoLocalModel(path, 'gpu')
  info.requested_backend = 'npu'
  info.resolved_backend = 'npu'
  info.modalities[0] = { modality: 'text', preferred_backends: ['npu'], npu_brand: 'qualcomm', soc_name: 'SM8750' }
  mocked.inspectLocalModel.mockResolvedValue(info)
  render(panel(path, 'npu'))
  await user.click(screen.getByRole('button', { name: i18n.t('settings.localModel.inspect') }))
  expect(await screen.findByText(/SM8750/)).toHaveTextContent('Qualcomm')
})

it('missing paths cannot start a native inspection', () => {
  render(panel('local://'))
  expect(screen.getByRole('button', { name: i18n.t('settings.localModel.inspect') })).toBeDisabled()
})

it('an explicit refresh runs another metadata query', async () => {
  const user = userEvent.setup()
  render(panel())
  await user.click(screen.getByRole('button', { name: i18n.t('settings.localModel.inspect') }))
  await user.click(await screen.findByRole('button', { name: i18n.t('settings.localModel.inspectAgain') }))
  await waitFor(() => expect(mocked.inspectLocalModel).toHaveBeenCalledTimes(2))
})
