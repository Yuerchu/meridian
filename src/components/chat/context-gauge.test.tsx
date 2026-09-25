import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextGauge } from './context-gauge'
import i18n from '@/i18n'
import type { ContextUsageView } from '@/hooks/use-context-info'

function reading(over: Partial<ContextUsageView> = {}): ContextUsageView {
  return {
    messageCount: 4,
    estimatedTokens: 50_000,
    contextLimit: 200_000,
    autoCompactEnabled: false,
    autoCompactThreshold: 0,
    compactBreaker: 'closed',
    model: 'm1',
    agentKind: null,
    ...over,
  }
}

describe('ContextGauge', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('measures a known window', () => {
    const { container } = render(<ContextGauge context={{ status: 'ready', reading: reading(), retry: () => {} }} />)
    const figures = i18n.t('chat.context.tokens', {
      used: (50_000).toLocaleString(),
      limit: (200_000).toLocaleString(),
    })
    expect(screen.getByRole('button', { name: figures })).toBeInTheDocument()
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull()
  })

  /** Nothing is drawn before the first answer: there used to be a 128k
   *  placeholder reading here, which is a window nobody configured. */
  it('draws nothing while the window is being read', () => {
    const { container } = render(<ContextGauge context={{ status: 'loading', retry: () => {} }} />)
    expect(container).toBeEmptyDOMElement()
  })

  /** A window nobody set cannot be read (the backend refuses to size a turn
   *  without one), so it is drawn as that failure, with the backend's reason,
   *  and is not divided into anything. */
  it('says the window could not be read, with the reason', async () => {
    const user = userEvent.setup()
    const reason = "No context window known for 'm1'. Go to Settings → Provider → Model to set one."
    const { container } = render(<ContextGauge context={{ status: 'unavailable', reason, retry: () => {} }} />)

    const trigger = screen.getByRole('button', { name: i18n.t('chat.context.unavailable') })
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    await user.click(trigger)
    expect(await screen.findByText(reason)).toBeInTheDocument()
  })

  /** A hosted session is measured by the agent; this app's failure to size
   *  its own request is not about that window. */
  it('leaves a hosted session to the agent', () => {
    const { container } = render(
      <ContextGauge
        hosted
        context={{ status: 'unavailable', reason: 'no provider', retry: () => {} }}
        agentUsage={null}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
