import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TurnBranchPager, TurnStatusIcon } from './turn-status'

describe('TurnBranchPager', () => {
  it('renders nothing when there is only one version', () => {
    const { container } = render(<TurnBranchPager index={1} total={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the position and moves in both directions', async () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    render(
      <TurnBranchPager
        index={2}
        total={3}
        onPrevious={onPrevious}
        onNext={onNext}
        previousLabel="Previous version"
        nextLabel="Next version"
      />,
    )

    expect(screen.getByText('2/3')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Previous version'))
    await userEvent.click(screen.getByLabelText('Next version'))
    expect(onPrevious).toHaveBeenCalledOnce()
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('stops at both ends', () => {
    const { rerender } = render(<TurnBranchPager index={1} total={3} previousLabel="prev" nextLabel="next" />)
    expect(screen.getByLabelText('prev')).toBeDisabled()
    expect(screen.getByLabelText('next')).toBeEnabled()

    rerender(<TurnBranchPager index={3} total={3} previousLabel="prev" nextLabel="next" />)
    expect(screen.getByLabelText('prev')).toBeEnabled()
    expect(screen.getByLabelText('next')).toBeDisabled()
  })

  it('goes fully inert while a stream is in flight', () => {
    render(<TurnBranchPager index={2} total={3} disabled previousLabel="prev" nextLabel="next" />)
    expect(screen.getByLabelText('prev')).toBeDisabled()
    expect(screen.getByLabelText('next')).toBeDisabled()
  })
})

describe('TurnStatusIcon', () => {
  /// A turn the user stopped needs no attention; one that stopped unexpectedly
  /// may have left something half-done, and is coloured to say so.
  it('colours a crash as a warning and a stop as nothing', () => {
    const { container, rerender } = render(<TurnStatusIcon status="crashed" />)
    expect(container.querySelector('svg')).toHaveClass('text-warning-soft-foreground')
    rerender(<TurnStatusIcon status="interrupted" />)
    expect(container.querySelector('svg')).toHaveClass('text-muted')
  })
})
