import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AcpNoticeBubble } from './acp-notice-bubble'
import { AcpNoticeActionsContext, type AcpNoticeActions } from './acp-notice-actions'
import i18n from '@/i18n'
import type { AcpSessionNoticeInfoResponse } from '@/types'

function notice(over: Partial<AcpSessionNoticeInfoResponse> = {}): AcpSessionNoticeInfoResponse {
  return {
    id: 'n1',
    conversation_id: 'c1',
    turn_id: 't1',
    notice_id: 'prompt-1:error',
    revision: 2,
    category: 'limit',
    severity: 'error',
    title: 'Rate limit reached.',
    details: 'Try again in a minute.',
    reason: null,
    actions: ['retry', 'new_session'],
    created_at: 1,
    updated_at: 1,
    ...over,
  }
}

function actions(over: Partial<AcpNoticeActions> = {}): AcpNoticeActions {
  return { retry: vi.fn(), restartAgent: vi.fn(), busy: false, ...over }
}

describe('AcpNoticeBubble', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  /** The record is the message: its own title and details, the adapter's
   *  category as a label, and the severity on the bubble for the fill. */
  it('draws the incident with its severity and category', () => {
    const { container } = render(<AcpNoticeBubble notice={notice()} retryText="run the tests" />)
    expect(screen.getByText('Rate limit reached.')).toBeVisible()
    expect(screen.getByText('Try again in a minute.')).toBeVisible()
    expect(screen.getByText('Limit')).toBeVisible()
    const bubble = container.querySelector('[data-slot="acp-notice"]')
    expect(bubble?.getAttribute('data-severity')).toBe('error')
    expect(bubble?.getAttribute('data-variant')).toBe('destructive')
  })

  it('draws a warning muted, not destructive', () => {
    const { container } = render(
      <AcpNoticeBubble notice={notice({ severity: 'warning', actions: [] })} retryText={null} />,
    )
    expect(container.querySelector('[data-slot="acp-notice"]')?.getAttribute('data-variant')).toBe('muted')
    expect(container.querySelector('[data-slot="acp-notice-actions"]')).toBeNull()
  })

  /** The two actions this app can take are buttons wired to the chat view's
   *  handlers; `login` is only ever a hint, since nothing here can sign in. */
  it('offers retry and restart through the provided actions', async () => {
    const provided = actions()
    render(
      <AcpNoticeActionsContext.Provider value={provided}>
        <AcpNoticeBubble notice={notice({ actions: ['retry', 'new_session', 'login'] })} retryText="run the tests" />
      </AcpNoticeActionsContext.Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(provided.retry).toHaveBeenCalledWith('run the tests')
    await userEvent.click(screen.getByRole('button', { name: 'Restart agent' }))
    expect(provided.restartAgent).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Sign in with/)).toBeVisible()
  })

  /** No button while a turn runs, and no retry without a question to re-send:
   *  a button that cannot do what it says is worse than none. */
  it('withholds the buttons while busy or without a question to retry', () => {
    const { rerender } = render(
      <AcpNoticeActionsContext.Provider value={actions({ busy: true })}>
        <AcpNoticeBubble notice={notice()} retryText="run the tests" />
      </AcpNoticeActionsContext.Provider>,
    )
    expect(screen.queryByRole('button')).toBeNull()

    rerender(
      <AcpNoticeActionsContext.Provider value={actions()}>
        <AcpNoticeBubble notice={notice({ actions: ['retry'] })} retryText={null} />
      </AcpNoticeActionsContext.Provider>,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})
