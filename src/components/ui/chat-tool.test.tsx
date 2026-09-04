import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@heroui/react'
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
import { BubbleKeyboard } from './bubble-keyboard'

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

describe('ChatTool on a keyboard', () => {
  function onKeyboard(ui: React.ReactNode) {
    return render(
      <ChatToolPresentationProvider value="keyboard">
        <BubbleKeyboard>{ui}</BubbleKeyboard>
      </ChatToolPresentationProvider>,
    )
  }

  it('renders the trigger as a key with no heading, and the panel in the stack', () => {
    const { container } = onKeyboard(
      <ChatTool state="output-available">
        <ChatToolTrigger>Read file</ChatToolTrigger>
        <ChatToolContent>contents</ChatToolContent>
      </ChatTool>,
    )
    const key = screen.getByRole('button', { name: /Read file/ })
    expect(container.querySelector('h3')).toBeNull()
    expect(container.querySelector('[data-slot="bubble-keyboard-row"]')).toContainElement(key)
    const panel = document.getElementById(key.getAttribute('aria-controls')!)!
    expect(container.querySelector('[data-slot="bubble-keyboard-stack"]')).toContainElement(panel)
    expectCollapsed(key)
  })

  it('carries the status onto both the key and the panel', () => {
    const { container } = onKeyboard(
      <ChatTool state="requires-action" defaultExpanded>
        <ChatToolTrigger>Write file</ChatToolTrigger>
        <ChatToolContent>Exact change</ChatToolContent>
      </ChatTool>,
    )
    const key = screen.getByRole('button', { name: /Write file/ })
    expect(key).toHaveAttribute('data-state', 'requires-action')
    expect(key).toHaveClass('basis-full')
    const panel = container.querySelector('[data-slot="chat-tool-content"]')!
    expect(panel.className).toContain('ring-warning')
  })

  it('closes on Escape from inside the panel and hands focus back to the key', async () => {
    onKeyboard(
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
    onKeyboard(
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
    const { container } = onKeyboard(
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
