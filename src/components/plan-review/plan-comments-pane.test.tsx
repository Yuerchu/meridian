import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PlanCommentsPane } from './plan-comments-pane'

const props = {
  comments: [],
  globalNote: '',
  onChangeComment: vi.fn(),
  onDeleteComment: vi.fn(),
  onSelectComment: vi.fn(),
  onGlobalNoteChange: vi.fn(),
}

describe('PlanCommentsPane', () => {
  it('uses distinct explicit heading ids for the desktop rail and mobile sheet', () => {
    const { container } = render(
      <>
        <PlanCommentsPane {...props} headingId="plan-comments-aside-heading" />
        <PlanCommentsPane {...props} headingId="plan-comments-sheet-heading" />
      </>,
    )

    expect(container.querySelectorAll('#plan-comments-aside-heading')).toHaveLength(1)
    expect(container.querySelectorAll('#plan-comments-sheet-heading')).toHaveLength(1)
    expect(container.querySelector('[aria-labelledby="plan-comments-aside-heading"]')).not.toBeNull()
    expect(container.querySelector('[aria-labelledby="plan-comments-sheet-heading"]')).not.toBeNull()
  })
})
