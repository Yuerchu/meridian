import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { SkillInfoResponse } from '@/types'
import { SkillSettings } from './skill-settings'

vi.mock('@/api', () => ({
  api: {
    listSkills: vi.fn(),
    listSkillBindings: vi.fn(),
    getSkillBody: vi.fn(),
    updateSkill: vi.fn(),
    createSkill: vi.fn(),
    deleteSkill: vi.fn(),
    rescanSkills: vi.fn(),
    setSkillBinding: vi.fn(),
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
    mockApi.listSkills.mockResolvedValue([SKILL])
    mockApi.listSkillBindings.mockResolvedValue([])
    mockApi.updateSkill.mockResolvedValue(SKILL)
  })

  it('does not send an empty body when SKILL.md could not be read', async () => {
    mockApi.getSkillBody.mockRejectedValue('disk gone')
    const user = await openEditor()

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.skills.bodyLoadError'))
    // Only the display name is still editable; the description waits for the body.
    expect(screen.getByLabelText(i18n.t('settings.skills.description'))).toBeDisabled()

    const name = screen.getByLabelText(i18n.t('settings.skills.displayName'))
    await user.clear(name)
    await user.type(name, 'Renamed')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    await waitFor(() => expect(mockApi.updateSkill).toHaveBeenCalledTimes(1))
    expect(mockApi.updateSkill).toHaveBeenCalledWith({ dirName: 'review', displayName: 'Renamed' })
  })

  it('retries the read and then saves the loaded body', async () => {
    mockApi.getSkillBody.mockRejectedValueOnce('busy').mockResolvedValueOnce('# body')
    const user = await openEditor()

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(await screen.findByDisplayValue('# body')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    await waitFor(() =>
      expect(mockApi.updateSkill).toHaveBeenCalledWith({
        dirName: 'review',
        displayName: 'Review',
        llmDescription: 'Review code',
        body: '# body',
      }),
    )
  })
})
