import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { SkillInfoResponse } from '@/types'
import { SkillSettings } from './skill-settings'

vi.mock('@/api', () => ({
  api: {
    skills: {
      list: vi.fn(),
      listBindings: vi.fn(),
      readBody: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      rescan: vi.fn(),
      setBinding: vi.fn(),
    },
  },
}))

const mockApi = vi.mocked(api)

const SKILL = {
  dir_name: 'review',
  llm_name: 'review',
  display_name: 'Review',
  llm_description: 'Review code',
  is_builtin: false,
  is_enabled: true,
  source: 'user',
} as unknown as SkillInfoResponse

async function openEditor() {
  const user = userEvent.setup()
  render(<SkillSettings />)
  await user.click(await screen.findByRole('button', { name: /Review/ }))
  return user
}

describe('SkillSettings editor', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.skills.list.mockResolvedValue([SKILL])
    mockApi.skills.listBindings.mockResolvedValue([])
    mockApi.skills.update.mockResolvedValue(SKILL)
  })

  it('does not send an empty body when SKILL.md could not be read', async () => {
    mockApi.skills.readBody.mockRejectedValue('disk gone')
    const user = await openEditor()

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.skills.bodyLoadError'))
    // Only the display name is still editable; the description waits for the body.
    expect(screen.getByLabelText(i18n.t('settings.skills.description'))).toBeDisabled()

    const name = screen.getByLabelText(i18n.t('settings.skills.displayName'))
    await user.clear(name)
    await user.type(name, 'Renamed')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    await waitFor(() => expect(mockApi.skills.update).toHaveBeenCalledTimes(1))
    expect(mockApi.skills.update).toHaveBeenCalledWith({ dir_name: 'review', display_name: 'Renamed' })
  })

  it('retries the read and then saves the loaded body', async () => {
    mockApi.skills.readBody.mockRejectedValueOnce('busy').mockResolvedValueOnce('# body')
    const user = await openEditor()

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(await screen.findByDisplayValue('# body')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() =>
      expect(mockApi.skills.update).toHaveBeenCalledWith({
        dir_name: 'review',
        display_name: 'Review',
        llm_description: 'Review code',
        body: '# body',
      }),
    )
  })
})
