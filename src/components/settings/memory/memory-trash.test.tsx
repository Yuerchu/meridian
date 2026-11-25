import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { MemoryInfoResponse } from '@/types'
import { MemoryTrash } from './memory-trash'

vi.mock('@/api', () => ({
  api: {
    listMemoryTrash: vi.fn(),
    restoreMemories: vi.fn(),
    purgeMemories: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

const ROW = { id: 'm1', key: 'likes-tea', content: 'Prefers oolong', deleted_by: 'lru' } as MemoryInfoResponse

function setup(onOpenChange = vi.fn(), onChanged = vi.fn()) {
  render(<MemoryTrash open onOpenChange={onOpenChange} onChanged={onChanged} />)
  return { user: userEvent.setup(), onOpenChange, onChanged }
}

describe('MemoryTrash', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.listMemoryTrash.mockResolvedValue([ROW])
    mockApi.restoreMemories.mockResolvedValue(null as never)
    mockApi.purgeMemories.mockResolvedValue(null as never)
  })

  it('is a drawer named by its title and described by the retention hint', async () => {
    setup()
    const dialog = await screen.findByRole('dialog', { name: i18n.t('settings.memory.trash.title') })
    expect(dialog).toHaveAccessibleDescription(i18n.t('settings.memory.trash.retentionHint'))
    expect(await screen.findByText('Prefers oolong')).toBeInTheDocument()
  })

  it('restores a row and tells the list behind it', async () => {
    const { user, onChanged } = setup()
    await user.click(await screen.findByRole('button', { name: i18n.t('settings.memory.trash.restore') }))
    await waitFor(() => expect(mockApi.restoreMemories).toHaveBeenCalledWith(['m1']))
    expect(onChanged).toHaveBeenCalled()
  })

  it('purges only after the confirmation is accepted', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: i18n.t('settings.memory.trash.purge') }))

    // Declined: nothing is sent.
    await user.click(await screen.findByRole('button', { name: i18n.t('common.cancel') }))
    expect(mockApi.purgeMemories).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: i18n.t('settings.memory.trash.purge') }))
    const confirmButtons = await screen.findAllByRole('button', { name: i18n.t('settings.memory.trash.purge') })
    await user.click(confirmButtons[confirmButtons.length - 1])
    await waitFor(() => expect(mockApi.purgeMemories).toHaveBeenCalledWith(['m1']))
  })

  it('asks to close on Escape', async () => {
    const { user, onOpenChange } = setup()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
