import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { AutoReviewSettings } from './auto-review-settings'

vi.mock('@/api', () => ({
  api: {
    getPreference: vi.fn(),
    setPreference: vi.fn(),
    listProviders: vi.fn(),
    fetchProviderModels: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

describe('AutoReviewSettings', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.listProviders.mockResolvedValue([])
    mockApi.setPreference.mockResolvedValue(undefined)
  })

  it('shows an error instead of a defaults form that would overwrite the rules', async () => {
    mockApi.getPreference.mockRejectedValueOnce('db locked')
    mockApi.getPreference.mockResolvedValue({ key: 'x', value: null } as never)
    const user = userEvent.setup()
    render(<AutoReviewSettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.autoReview.loadError'))
    expect(screen.queryByRole('button', { name: i18n.t('common.save') })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(await screen.findByRole('button', { name: i18n.t('common.save') })).toBeInTheDocument()
    expect(mockApi.setPreference).not.toHaveBeenCalled()
  })
})
