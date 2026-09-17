import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/base'
import { describe, expect, it } from 'vitest'
import { expectCollapsed, expectExpanded } from '@/test/disclosure'
import {
  ChatTool,
  ChatToolApproval,
  ChatToolContent,
  ChatToolPresentationProvider,
  ChatToolStatusIcon,
  ChatToolTrigger,
} from './chat-tool'

describe('ChatTool', () => {
  it('exposes active state without treating a queued call as busy', () => {
    const { container, rerender } = render(
      <ChatTool state="input-available">
        <ChatToolTrigger>Run command</ChatToolTrigger>
      </ChatTool>,
    )

    const root = container.querySelector('[data-slot="chat-tool"]')!
    expect(root).toHaveAttribute('data-state', 'input-available')
    expect(root).toHaveAttribute('data-active', 'true')

    rerender(
      <ChatTool state="queued">
        <ChatToolTrigger>
          <ChatToolStatusIcon />
          Run command
        </ChatToolTrigger>
      </ChatTool>,
    )

    expect(root).toHaveAttribute('data-state', 'queued')
    expect(root).not.toHaveAttribute('data-active')
    expect(container.querySelector('[data-slot="chat-tool-status-icon"]')).not.toHaveClass('animate-spin')
  })

  it('keeps its content behind a keyboard-operable disclosure', async () => {
    render(
      <ChatTool state="requires-action">
        <ChatToolTrigger subtitle="Needed to update the configuration">Write file</ChatToolTrigger>
        <ChatToolContent>Exact change</ChatToolContent>
      </ChatTool>,
    )

    const trigger = screen.getByRole('button', { name: /Write file/ })
    expectCollapsed(trigger)

    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expectExpanded(trigger)
    expect(screen.getByText('Exact change')).toBeVisible()
  })

  it('wraps approval actions in the Pro-style actions region', () => {
    const { container } = render(
      <ChatToolApproval>
        <Button>Reject</Button>
        <Button>Allow without sandbox</Button>
      </ChatToolApproval>,
    )

    const actions = container.querySelector('[data-slot="chat-tool-approval-actions"]')!
    expect(actions).toHaveClass('flex-wrap')
    expect(screen.getByRole('button', { name: 'Reject' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Allow without sandbox' })).toBeVisible()
  })
})

describe('ChatTool as a bubble block', () => {
  function inBubble(ui: React.ReactNode) {
    return render(<ChatToolPresentationProvider value="bubble">{ui}</ChatToolPresentationProvider>)
  }

  it('is one block holding both the head and the detail, with no heading', () => {
    const { container } = inBubble(
      <ChatTool state="output-available">
        <ChatToolTrigger>Read file</ChatToolTrigger>
        <ChatToolContent>contents</ChatToolContent>
      </ChatTool>,
    )
    const key = screen.getByRole('button', { name: /Read file/ })
    expect(container.querySelector('h3')).toBeNull()
    const block = container.querySelector('[data-slot="chat-tool"]')!
    // What `bubble.tsx` styles it by, and the whole of why there is no portal:
    // the head and the panel are children of this one element.
    expect(block).toHaveAttribute('data-bubble-block')
    expect(block).toContainElement(key)
    const panel = document.getElementById(key.getAttribute('aria-controls')!)!
    expect(block).toContainElement(panel)
    expectCollapsed(key)
  })

  it('carries the status on the block, which is the one edge around both halves', () => {
    const { container } = inBubble(
      <ChatTool state="requires-action" defaultExpanded>
        <ChatToolTrigger>Write file</ChatToolTrigger>
        <ChatToolContent>Exact change</ChatToolContent>
      </ChatTool>,
    )
    const key = screen.getByRole('button', { name: /Write file/ })
    expect(key).toHaveAttribute('data-state', 'requires-action')
    const block = container.querySelector('[data-slot="chat-tool"]')!
    // A decision takes the column whatever else is true, and the ring is on the
    // block rather than on either half — one outline, not two.
    expect(block.className).toContain('ring-warning')
    expect(block.className).toContain('w-full')
    expect(container.querySelector('[data-slot="chat-tool-content"]')!.className).not.toContain('ring-warning')
  })

  it('closes on Escape from inside the panel and hands focus back to the key', async () => {
    inBubble(
      <ChatTool state="output-available" defaultExpanded>
        <ChatToolTrigger>Read file</ChatToolTrigger>
        <ChatToolContent>
          <Button>Show all</Button>
        </ChatToolContent>
      </ChatTool>,
    )
    const key = screen.getByRole('button', { name: /Read file/ })
    expectExpanded(key)
    screen.getByRole('button', { name: 'Show all' }).focus()
    await userEvent.keyboard('{Escape}')
    expectCollapsed(key)
    expect(key).toHaveFocus()
  })

  it('leaves Escape to a field inside the panel', async () => {
    inBubble(
      <ChatTool state="requires-action" defaultExpanded>
        <ChatToolTrigger>Run command</ChatToolTrigger>
        <ChatToolContent>
          <input aria-label="reason" />
        </ChatToolContent>
      </ChatTool>,
    )
    const key = screen.getByRole('button', { name: /Run command/ })
    screen.getByLabelText('reason').focus()
    await userEvent.keyboard('{Escape}')
    expectExpanded(key)
  })

  it('shares the decision row equally between its keys', () => {
    const { container } = inBubble(
      <ChatToolApproval>
        <Button>Reject</Button>
        <Button>Allow</Button>
      </ChatToolApproval>,
    )
    const actions = container.querySelector('[data-slot="chat-tool-approval-actions"]')!
    expect(actions.className).toContain('[&>button]:flex-1')
    expect(actions).not.toHaveClass('justify-end')
  })
})
