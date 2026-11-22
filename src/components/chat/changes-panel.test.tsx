import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import { ChangesPanelView } from './changes-panel'

describe('ChangesPanelView', () => {
  beforeEach(() => i18n.changeLanguage('en'))

  it('includes the file operation in each tree row accessible name', async () => {
    render(
      <ChangesPanelView
        files={[
          { path: 'src/created.ts', op: 'create', count: 1 },
          { path: 'src/changed.ts', op: 'modify', count: 2 },
          { path: 'deleted.txt', op: 'delete', count: 1 },
        ]}
        onClose={vi.fn()}
      />,
    )

    // Rows fade in as the tree's collection lands (the registry tree's own motion).
    await waitFor(() => expect(screen.getByRole('row', { name: 'created.ts, created' })).toBeVisible())
    expect(screen.getByRole('row', { name: 'changed.ts, modified' })).toBeVisible()
    expect(screen.getByRole('row', { name: 'deleted.txt, deleted' })).toBeVisible()
  })

  it('shows how many times a file changed, and closes', async () => {
    const onClose = vi.fn()
    render(<ChangesPanelView files={[{ path: 'src/changed.ts', op: 'modify', count: 3 }]} onClose={onClose} />)
    await waitFor(() => expect(screen.getByRole('row', { name: 'changed.ts, modified' })).toBeVisible())
    expect(screen.getByText('×3')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens every directory on arrival and lets one be folded', async () => {
    const user = userEvent.setup()
    render(<ChangesPanelView files={[{ path: 'src/a.ts', op: 'create', count: 1 }]} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('row', { name: 'a.ts, created' })).toBeVisible())

    await user.click(screen.getByRole('button', { name: /expand|collapse/i }))
    await waitFor(() => expect(screen.queryByRole('row', { name: 'a.ts, created' })).not.toBeInTheDocument())
  })

  it('says so when nothing changed', () => {
    render(<ChangesPanelView files={[]} onClose={vi.fn()} />)
    expect(screen.getByText(i18n.t('chat.changes.empty'))).toBeInTheDocument()
  })
})
