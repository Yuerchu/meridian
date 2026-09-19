import { render, screen } from '@testing-library/react'

import i18n from '@/i18n'
import { ChangesPanelView } from './changes-panel'

describe('ChangesPanelView', () => {
  beforeEach(() => i18n.changeLanguage('en'))

  it('includes the file operation in each tree row accessible name', () => {
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

    expect(screen.getByRole('row', { name: 'created.ts, created' })).toBeVisible()
    expect(screen.getByRole('row', { name: 'changed.ts, modified' })).toBeVisible()
    expect(screen.getByRole('row', { name: 'deleted.txt, deleted' })).toBeVisible()
  })
})
