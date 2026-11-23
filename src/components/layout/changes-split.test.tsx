import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ResizablePanels } from '@/components/yuerchu-ui/components/resizable-panels/resizable-panels'
import { CHANGES_SPLIT } from './changes-split'

describe('chat / changes split', () => {
  it('opens the chat pane at 70% (changes at 30%) and clamps to the configured bounds', () => {
    const { getByRole } = render(
      <ResizablePanels orientation="horizontal" {...CHANGES_SPLIT} aria-label="changes">
        {[<div>chat</div>, <div>changes</div>]}
      </ResizablePanels>,
    )
    const handle = getByRole('separator', { name: 'changes' })
    expect(handle).toHaveAttribute('aria-valuenow', '70')
    expect(handle).toHaveAttribute('aria-valuemin', '50')
    expect(handle).toHaveAttribute('aria-valuemax', '75')
  })

  it('keeps the separator reachable and adjustable from the keyboard', async () => {
    const user = userEvent.setup()
    const { getByRole } = render(
      <ResizablePanels orientation="horizontal" {...CHANGES_SPLIT} aria-label="changes">
        {[<div>chat</div>, <div>changes</div>]}
      </ResizablePanels>,
    )
    const handle = getByRole('separator', { name: 'changes' })
    expect(handle.tabIndex).toBe(0)
    handle.focus()
    await user.keyboard('{Home}')
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    await user.keyboard('{End}')
    expect(handle).toHaveAttribute('aria-valuenow', '75')
  })
})
