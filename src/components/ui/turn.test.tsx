import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Turn, TurnBranchPager, TurnContent, TurnTrigger } from './turn'

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
    const { rerender } = render(
      <TurnBranchPager index={1} total={3} previousLabel="prev" nextLabel="next" />,
    )
    expect(screen.getByLabelText('prev')).toBeDisabled()
    expect(screen.getByLabelText('next')).toBeEnabled()

    rerender(<TurnBranchPager index={3} total={3} previousLabel="prev" nextLabel="next" />)
    expect(screen.getByLabelText('prev')).toBeEnabled()
    expect(screen.getByLabelText('next')).toBeDisabled()
  })

  it('goes fully inert while a stream is in flight', () => {
    render(<TurnBranchPager index={2} total={3} isDisabled previousLabel="prev" nextLabel="next" />)
    expect(screen.getByLabelText('prev')).toBeDisabled()
    expect(screen.getByLabelText('next')).toBeDisabled()
  })
})

describe('Turn', () => {
  it('reports its collapsed state on the trigger', async () => {
    render(
      <Turn status="complete">
        <TurnTrigger>Worked for 9m 46s</TurnTrigger>
        <TurnContent>process</TurnContent>
      </Turn>,
    )

    const trigger = screen.getByRole('button', { name: /Worked for/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('exposes the status for styling hooks', () => {
    const { container } = render(
      <Turn status="awaiting-input">
        <TurnTrigger>Waiting for you</TurnTrigger>
      </Turn>,
    )
    expect(container.querySelector('[data-slot="turn-collapsible"]')).toHaveAttribute(
      'data-status',
      'awaiting-input',
    )
  })
})
