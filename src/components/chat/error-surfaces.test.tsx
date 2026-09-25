import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { ContextGauge } from './context-gauge'
import type { ContextUsageView } from '@/hooks/use-context-info'
import { TranscriptStatus } from './transcript-status'

vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => 'windows' }))

/**
 * Where the message page puts a failure, and that each one carries the
 * backend's own words, is announced, and offers what can be done about it.
 */
describe('transcript status', () => {
  it('draws an action error as an announced alert with the reason, dismissable', async () => {
    const onDismissError = vi.fn()
    render(
      <TranscriptStatus
        compacting={false}
        error="provider rejected the API key"
        onDismissError={onDismissError}
        redactionNotice={null}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('provider rejected the API key')
    await userEvent.click(within(alert).getByRole('button', { name: i18n.t('common.dismiss') }))
    expect(onDismissError).toHaveBeenCalledTimes(1)
  })

  it('draws a failed read with its reason and a retry', async () => {
    const onRetryLoad = vi.fn()
    render(
      <TranscriptStatus
        compacting={false}
        error={null}
        loadError="database is locked"
        onRetryLoad={onRetryLoad}
        redactionNotice={null}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('chat.error.loadTitle'))
    expect(alert).toHaveTextContent('database is locked')
    await userEvent.click(within(alert).getByRole('button', { name: i18n.t('common.retry') }))
    expect(onRetryLoad).toHaveBeenCalledTimes(1)
  })

  it('draws a failed checklist read with its own retry', async () => {
    const onRetryTodos = vi.fn()
    render(
      <TranscriptStatus
        compacting={false}
        error={null}
        todosError="timed out"
        onRetryTodos={onRetryTodos}
        redactionNotice={null}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('timed out')
    await userEvent.click(within(alert).getByRole('button', { name: i18n.t('common.retry') }))
    expect(onRetryTodos).toHaveBeenCalledTimes(1)
  })
})

describe('context gauge', () => {
  const reading = (over: Partial<ContextUsageView> = {}): ContextUsageView => ({
    messageCount: 3,
    estimatedTokens: 1000,
    contextLimit: 128_000,
    autoCompactEnabled: false,
    autoCompactThreshold: 0,
    compactBreaker: 'closed',
    model: 'm',
    agentKind: null,
    ...over,
  })

  // It used to swallow the failure and keep drawing whatever it had — the
  // previous conversation's numbers, or, before any reading, nothing at all.
  it('replaces the dial with the failure, whose popover has the reason and a retry', async () => {
    const retry = vi.fn()
    render(<ContextGauge context={{ status: 'unavailable', reason: 'no model configured', retry }} />)

    const trigger = screen.getByRole('button', { name: i18n.t('chat.context.unavailable') })
    await userEvent.click(trigger)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('no model configured')
    await userEvent.click(within(alert).getByRole('button', { name: i18n.t('common.retry') }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('draws the dial when the reading is good', () => {
    render(<ContextGauge context={{ status: 'ready', reading: reading(), retry: () => {} }} />)
    expect(screen.queryByRole('button', { name: i18n.t('chat.context.unavailable') })).toBeNull()
  })
})
