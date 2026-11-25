import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import type { ProjectInfoResponse } from '@/types'
import { MoveDialog } from './move-dialog'

const PROJECTS = [
  { id: 'p1', name: 'Atlas', source_type: 'local' },
  { id: 'p2', name: 'Borealis', source_type: 'local' },
] as unknown as ProjectInfoResponse[]

function setup(over: Partial<React.ComponentProps<typeof MoveDialog>> = {}) {
  const onMove = vi.fn().mockResolvedValue(true)
  const onOpenChange = vi.fn()
  render(
    <MoveDialog
      isOpen
      onOpenChange={onOpenChange}
      projects={PROJECTS}
      currentProjectId="p1"
      error={null}
      isPending={false}
      onMove={onMove}
      {...over}
    />,
  )
  return { user: userEvent.setup(), onMove, onOpenChange }
}

describe('MoveDialog', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('moves to the chosen project and closes', async () => {
    const { user, onMove, onOpenChange } = setup()
    await user.click(await screen.findByRole('option', { name: 'Borealis' }))
    expect(onMove).toHaveBeenCalledWith('p2')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('files under no project as null', async () => {
    const { user, onMove } = setup()
    await user.click(await screen.findByRole('option', { name: i18n.t('moveDialog.noProject') }))
    expect(onMove).toHaveBeenCalledWith(null)
  })

  it('says where it is filed now, and does not offer that place again', async () => {
    const { user, onMove } = setup()
    const current = await screen.findByRole('option', { name: 'Atlas' })
    expect(current).toHaveAttribute('aria-disabled', 'true')
    expect(current).toHaveAccessibleDescription(i18n.t('moveDialog.currentLocation'))
    await user.click(current)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('stays open and shows the error when the move fails', async () => {
    const { user, onOpenChange } = setup({ error: 'No space', onMove: vi.fn().mockResolvedValue(false) })
    expect(await screen.findByText('No space')).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Borealis' }))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
