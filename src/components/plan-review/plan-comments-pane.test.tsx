import { fireEvent, render } from '@testing-library/react'
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

describe('PlanCommentsPane orphaned comments', () => {
  const anchor = { kind: 'source_range' as const, from: 2, to: 6, quote: 'Plan', prefix: '# ', suffix: '\n' }
  const comment = (id: string, state: 'active' | 'orphaned') => ({
    id,
    review_id: 'review-1',
    position: 0,
    state,
    anchor: { ...anchor, quote: `${id} quote` },
    body: '',
    created_at: 1,
    updated_at: 1,
  })

  it('does not offer an orphaned quote as a way to the text it no longer marks', () => {
    const onSelectComment = vi.fn()
    const { getByText } = render(
      <PlanCommentsPane
        {...props}
        headingId="plan-comments"
        onSelectComment={onSelectComment}
        comments={[comment('live', 'active'), comment('lost', 'orphaned')]}
      />,
    )

    expect(getByText('live quote').closest('a, [role="link"]')).not.toBeNull()
    const lost = getByText('lost quote')
    expect(lost.closest('a, [role="link"]')).toBeNull()
    fireEvent.click(lost)
    expect(onSelectComment).not.toHaveBeenCalled()
  })
})
