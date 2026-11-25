import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import { AutoReviewSettings } from './auto-review-settings'

vi.mock('@/api', () => ({
  api: {
    preferences: {
      get: vi.fn(),
      set: vi.fn(),
    },
    providers: {
      list: vi.fn(),
      listModels: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)

describe('AutoReviewSettings', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.providers.list.mockResolvedValue([])
    mockApi.preferences.set.mockResolvedValue(undefined)
  })

  it('shows an error instead of a defaults form that would overwrite the rules', async () => {
    mockApi.preferences.get.mockRejectedValueOnce('db locked')
    mockApi.preferences.get.mockResolvedValue({ key: 'x', value: null } as never)
    const user = userEvent.setup()
    render(<AutoReviewSettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.autoReview.loadError'))
    expect(screen.queryByRole('button', { name: i18n.t('common.save') })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(await screen.findByRole('button', { name: i18n.t('common.save') })).toBeInTheDocument()
    expect(mockApi.preferences.set).not.toHaveBeenCalled()
  })
})
