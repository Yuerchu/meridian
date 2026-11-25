import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Bin, Pen } from '@keyline-icons/react/two-tone'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Menu, MenuTrigger } from '@/components/yuerchu-ui/components/menu/menu'
import { RowActionDropdownItems } from './row-actions-menu'
import type { RowAction } from './row-actions'

function open(actions: RowAction[]) {
  render(
    <MenuTrigger>
      <Button>Actions</Button>
      <Menu aria-label="Row actions">
        <RowActionDropdownItems actions={actions} />
      </Menu>
    </MenuTrigger>,
  )
  return userEvent.setup()
}

describe('RowActionDropdownItems', () => {
  it('runs an action and keeps a disabled one out of reach, saying why in its own text', async () => {
    const run = vi.fn()
    const blocked = vi.fn()
    const user = open([
      { key: 'rename', label: 'Rename', icon: Pen, run },
      { key: 'export', label: 'Export', icon: Pen, run: blocked, disabledReason: 'Still running' },
    ] as unknown as RowAction[])

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    const exportItem = await screen.findByRole('menuitem', { name: 'Export' })
    expect(exportItem).toHaveAttribute('aria-disabled', 'true')
    expect(exportItem).toHaveAccessibleDescription('Still running')

    await user.click(exportItem)
    expect(blocked).not.toHaveBeenCalled()

    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('marks a destructive action as danger', async () => {
    const user = open([
      { key: 'delete', label: 'Delete', icon: Bin, variant: 'destructive', run: vi.fn() },
    ] as unknown as RowAction[])
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-tone', 'danger')
  })
})
