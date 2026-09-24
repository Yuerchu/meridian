import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePlanReviewStore } from '@/stores/plan-review-store'
import { registerPlanReviewLeaveGuard, usePlanReviewNavigation } from './navigation'

let leave: () => Promise<boolean> = async () => true

function Shell() {
  leave = usePlanReviewNavigation()
  const open = usePlanReviewStore((state) => state.activeReviewId)
  return (
    <>
      <button data-slot="opener" onClick={() => usePlanReviewStore.getState().openReview('review-1')}>
        open
      </button>
      {open && <p data-slot="review-layer">review</p>}
    </>
  )
}

describe('usePlanReviewNavigation', () => {
  beforeEach(() => {
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
  })

  it('hands focus back to whatever opened the review', async () => {
    render(<Shell />)
    const opener = screen.getByRole('button', { name: 'open' })
    await userEvent.click(opener)
    expect(screen.getByText('review')).toBeInTheDocument()
    // The page takes focus while it is open.
    act(() => opener.blur())

    await act(async () => {
      await leave()
    })
    expect(screen.queryByText('review')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('stays open when the page refuses to be left', async () => {
    render(<Shell />)
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    const unregister = registerPlanReviewLeaveGuard(async () => false)

    let left: boolean | undefined
    await act(async () => {
      left = await leave()
    })
    expect(left).toBe(false)
    expect(screen.getByText('review')).toBeInTheDocument()
    unregister()
  })
})
