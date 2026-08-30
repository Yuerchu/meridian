import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@heroui/react'
import { describe, expect, it } from 'vitest'
import { expectCollapsed, expectExpanded } from '@/test/disclosure'
import { ChatTool, ChatToolApproval, ChatToolContent, ChatToolStatusIcon, ChatToolTrigger } from './chat-tool'

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
