import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsageSettings } from './usage-settings'
// Imported for the side effect of initialising i18next. Without it every `t()`
// returns its key, and the two range buttons — one key, two counts — become
// indistinguishable to a query by name.
import i18n from '@/i18n'
import { api } from '@/api'
import { decimal } from '@/lib/decimal'
import type { UsageBucketInfoResponse, UsageDimension, UsageReportRequest } from '@/types'

vi.mock('@/api', () => ({ api: { usageReport: vi.fn() } }))

const mockApi = vi.mocked(api)
const onOpenConversation = vi.fn()

function bucket(over: Partial<UsageBucketInfoResponse> = {}): UsageBucketInfoResponse {
  return {
    key: 'k',
    label: 'A conversation',
    messages: 4,
    metered_messages: 4,
    subscription_messages: 0,
    external_messages: 0,
    missing_token_usage_messages: 0,
    incomplete_token_usage_messages: 0,
    input_tokens: 1_000,
    output_tokens: 500,
    cache_read_tokens: 250,
    cache_write_tokens: 0,
    input_cost: decimal('0.5'),
    output_cost: decimal('0.75'),
    cache_cost: decimal('0.2'),
    tool_cost: decimal('0.05'),
    total_cost: decimal('1.5'),
    unpriced_token_messages: 0,
    unpriced_tool_messages: 0,
    estimated_token_messages: 0,
    estimated_tool_messages: 0,
    estimated_messages: 0,
    unpriced_messages: 0,
    ...over,
  }
}

/** Answers each of the five groupings the panel asks for. */
function serve(by: Partial<Record<UsageDimension, UsageBucketInfoResponse[]>>) {
  mockApi.usageReport.mockImplementation((request: UsageReportRequest) => Promise.resolve(by[request.dimension] ?? []))
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

it('shows a recoverable error when the initial report fails', async () => {
  mockApi.usageReport.mockRejectedValue(new Error('offline'))
  const user = userEvent.setup()
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByRole('alert')).toHaveTextContent('Usage could not be loaded.')
  serve({ total: [bucket()] })
  await user.click(screen.getByRole('button', { name: 'Try again' }))

  expect(await screen.findByText('1.50', { selector: '[data-slot="cost-total"]' })).toBeInTheDocument()
})

/**
 * The one claim this page must never make quietly. A model with no price
 * contributes tokens and no cost, so a total shown on its own is smaller than
 * the truth with nothing to say so.
 */
it('says so when part of the traffic could not be priced', async () => {
  serve({
    total: [bucket({ messages: 10, unpriced_token_messages: 4, unpriced_messages: 4, total_cost: decimal('2') })],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByText('≥ 2.00', { selector: '[data-slot="cost-total"]' })).toBeInTheDocument()
  await waitFor(() => {
    expect(document.querySelector('[data-slot="unpriced-warning"]')).not.toBeNull()
  })
})

it('shows backend cost components without deriving them from token totals', async () => {
  serve({
    total: [
      bucket({
        input_tokens: 99_000_000,
        input_cost: decimal('0.1234567'),
        cache_cost: decimal('0.000321'),
        output_cost: decimal('0.45'),
        tool_cost: decimal('0.006'),
        total_cost: decimal('0.5797777'),
      }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const breakdown = await screen.findByRole('region', { name: 'Cost breakdown' })
  expect(within(breakdown).getByText('0.123457')).toBeInTheDocument()
  expect(within(breakdown).getByText('0.000321')).toBeInTheDocument()
  expect(within(breakdown).getByText('0.45')).toBeInTheDocument()
  expect(within(breakdown).getByText('0.006')).toBeInTheDocument()
  expect(screen.getByText('0.579778', { selector: '[data-slot="cost-total"]' })).toBeInTheDocument()
})

it('does not round a positive sub-micro charge down to zero', async () => {
  serve({
    total: [
      bucket({
        input_cost: decimal('0.0000004'),
        output_cost: decimal('0'),
        cache_cost: decimal('0'),
        tool_cost: decimal('0'),
        total_cost: decimal('0.0000004'),
        unpriced_token_messages: 1,
        unpriced_messages: 1,
      }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByText(/^≥ 4E-7$/i, { selector: '[data-slot="cost-total"]' })).toBeInTheDocument()
})

it('qualifies token and tool components independently', async () => {
  serve({
    total: [
      bucket({
        tool_cost: decimal('0'),
        total_cost: decimal('1.45'),
        unpriced_tool_messages: 1,
        unpriced_messages: 1,
      }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const breakdown = await screen.findByRole('region', { name: 'Cost breakdown' })
  expect(within(breakdown).getByText('0.50')).toBeInTheDocument()
  expect(within(breakdown).queryByText('≥ 0.50')).not.toBeInTheDocument()
  expect(within(breakdown).getByText('≥ 0.00')).toBeInTheDocument()
})

it('keeps estimates distinct from lower bounds, including an incomplete estimate', async () => {
  serve({
    total: [
      bucket({
        tool_cost: decimal('0'),
        total_cost: decimal('1.45'),
        estimated_token_messages: 1,
        estimated_messages: 1,
        unpriced_tool_messages: 1,
        unpriced_messages: 1,
      }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByText('≈ 1.45 (incomplete)', { selector: '[data-slot="cost-total"]' })).toBeInTheDocument()
  expect(screen.queryByText('≥ 1.45', { selector: '[data-slot="cost-total"]' })).not.toBeInTheDocument()
  expect(
    screen.getByText(
      '1 replies use current-price estimates, and 1 still have incomplete usage or pricing. Amounts marked ≈ are incomplete estimates.',
    ),
  ).toBeInTheDocument()

  const breakdown = screen.getByRole('region', { name: 'Cost breakdown' })
  expect(within(breakdown).getByText('≈ 0.50')).toBeInTheDocument()
  expect(within(breakdown).getByText('≥ 0.00')).toBeInTheDocument()
})

it('marks a complete current-price fallback as an estimate', async () => {
  serve({
    total: [bucket({ estimated_token_messages: 1, estimated_messages: 1 })],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByText('≈ 1.50', { selector: '[data-slot="cost-total"]' })).toBeInTheDocument()
  expect(document.querySelector('[data-slot="estimated-warning"]')).toHaveTextContent(
    '1 replies use current provider/model prices because historical snapshots are unavailable. Amounts marked ≈ are estimates.',
  )
})

it('draws provider and model bars from backend cost components', async () => {
  serve({
    total: [bucket()],
    provider: [
      bucket({
        label: 'Provider A',
        input_tokens: 0,
        input_cost: decimal('0.25'),
        cache_cost: decimal('0'),
        output_cost: decimal('0.5'),
      }),
    ],
    model: [
      bucket({
        label: 'Model A',
        input_tokens: 0,
        input_cost: decimal('0.1'),
        cache_cost: decimal('0'),
        output_cost: decimal('0.2'),
      }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const providerSection = (await screen.findByRole('heading', { name: 'Cost by provider' })).closest('section')
  expect(providerSection).not.toBeNull()
  expect(within(providerSection as HTMLElement).getByText('Uncached input')).toBeInTheDocument()
  expect(within(providerSection as HTMLElement).getByText('Output')).toBeInTheDocument()
  expect(within(providerSection as HTMLElement).queryByText('Input · uncached')).not.toBeInTheDocument()
})

it('keeps the warning off when everything has a price', async () => {
  serve({ total: [bucket({ unpriced_messages: 0 })] })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  await screen.findByText('Cost', { selector: '[data-slot="kpi-title"]' })
  expect(document.querySelector('[data-slot="unpriced-warning"]')).toBeNull()
})

it('does not render externally settled traffic as an exact local zero', async () => {
  serve({
    total: [
      bucket({
        messages: 2,
        metered_messages: 0,
        external_messages: 2,
        total_cost: decimal('0'),
        input_cost: decimal('0'),
        output_cost: decimal('0'),
        cache_cost: decimal('0'),
        tool_cost: decimal('0'),
      }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const cost = await screen.findByText('External billing', { selector: '[data-slot="cost-total"]' })
  expect(cost).toBeInTheDocument()
  expect(screen.getByText('No locally metered cost breakdown is available for this traffic.')).toBeInTheDocument()
  expect(
    screen.getByText(
      "0 replies were covered by subscriptions and 2 were settled externally; displayed amounts include only Meridian's locally metered traffic.",
    ),
  ).toBeInTheDocument()
})

/**
 * Zero prompt tokens is no data, not a total cache miss. Dividing anyway prints
 * "0.0%", which is a claim about the provider rather than about the absence of
 * one.
 */
it('shows a dash for the hit rate rather than dividing by nothing', async () => {
  serve({ total: [bucket({ messages: 2, input_tokens: 0, cache_read_tokens: 0 })] })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByText('—')).toBeInTheDocument()
})

it('does not present a cache-hit rate as exact when prompt usage is incomplete', async () => {
  serve({
    total: [
      bucket({
        messages: 1,
        metered_messages: 1,
        input_tokens: 900,
        output_tokens: 20,
        cache_read_tokens: 900,
        incomplete_token_usage_messages: 1,
      }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByText('—')).toBeInTheDocument()
  expect(screen.queryByText('100.0%')).not.toBeInTheDocument()
})

it('distinguishes unavailable, partial, and explicit-zero token totals', async () => {
  serve({
    total: [
      bucket({
        messages: 2,
        missing_token_usage_messages: 2,
        incomplete_token_usage_messages: 2,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
      }),
    ],
    conversation: [
      bucket({
        key: 'partial',
        label: 'Partial usage',
        messages: 2,
        missing_token_usage_messages: 1,
        incomplete_token_usage_messages: 1,
        input_tokens: 1_000,
        output_tokens: 500,
      }),
      bucket({
        key: 'zero',
        label: 'Explicit zero',
        messages: 1,
        input_tokens: 0,
        output_tokens: 0,
      }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect((await screen.findAllByText('Unavailable')).length).toBeGreaterThanOrEqual(2)
  expect(screen.getByText('The provider did not report token usage.')).toBeInTheDocument()

  const grid = screen.getByRole('treegrid', { name: 'Breakdown: Conversation' })
  const partialRow = within(grid)
    .getByRole('rowheader', { name: 'Partial usage' })
    .closest('[role="row"]') as HTMLElement
  expect(within(partialRow).getByText('≥ 1.5K')).toBeInTheDocument()
  const zeroRow = within(grid).getByRole('rowheader', { name: 'Explicit zero' }).closest('[role="row"]') as HTMLElement
  expect(within(zeroRow).getByText('0')).toBeInTheDocument()
})

it('formats compact token totals with the selected app language instead of the OS locale', async () => {
  await i18n.changeLanguage('zh-CN')
  serve({
    total: [bucket()],
    conversation: [
      bucket({
        key: 'partial',
        label: 'Partial usage',
        messages: 2,
        missing_token_usage_messages: 1,
        incomplete_token_usage_messages: 1,
        input_tokens: 1_000,
        output_tokens: 500,
      }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const grid = await screen.findByRole('treegrid', { name: '明细: 对话' })
  const row = within(grid).getByRole('rowheader', { name: 'Partial usage' }).closest('[role="row"]') as HTMLElement
  expect(within(row).getByText('≥ 1500')).toBeInTheDocument()
})

/**
 * The prompt is drawn as the parts that cost different amounts. The cache
 * figures are subsets of `input_tokens`, so a band for the full input beside a
 * band for the cached part would draw the cached tokens twice.
 */
it('splits the prompt into what missed cache and what did not', async () => {
  serve({ total: [bucket()], day: [bucket({ key: '2026-08-13' })] })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByText('Input · uncached')).toBeInTheDocument()
  expect(screen.getByText('Input · cache hit')).toBeInTheDocument()
  expect(screen.getAllByText('Output')).not.toHaveLength(0)
})

/**
 * Cache writes are zero on every provider but Anthropic. A legend entry the
 * reader can never find in the chart is worse than one band fewer.
 */
it('leaves out a band that is zero everywhere', async () => {
  serve({ total: [bucket()], day: [bucket({ cache_write_tokens: 0 })] })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  await screen.findByText('Input · uncached')
  expect(screen.queryByText('Input · cache write')).toBeNull()
})

it('draws the cache write band once there is one', async () => {
  serve({
    total: [bucket()],
    day: [bucket({ input_tokens: 1_000, cache_read_tokens: 200, cache_write_tokens: 300 })],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByText('Input · cache write')).toBeInTheDocument()
})

/** A row whose subject has been deleted keeps its cost and loses its name. */
it('names a deleted row as deleted instead of dropping it', async () => {
  serve({
    total: [bucket()],
    conversation: [bucket({ key: 'gone', label: null })],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  expect(await screen.findByText('Deleted')).toBeInTheDocument()
})

it('renders the selected breakdown as a labelled data grid', async () => {
  serve({
    total: [bucket()],
    conversation: [bucket({ key: 'conversation-1' })],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const grid = await screen.findByRole('treegrid', { name: 'Breakdown: Conversation' })
  expect(within(grid).getByRole('columnheader', { name: 'Conversation' })).toBeInTheDocument()
  expect(within(grid).getByRole('columnheader', { name: 'Tokens' })).toBeInTheDocument()
  expect(within(grid).getByRole('columnheader', { name: 'Cost' })).toBeInTheDocument()
  expect(within(grid).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument()
  const rowHeader = within(grid).getByRole('rowheader', { name: 'A conversation' })
  const row = rowHeader.closest('[role="row"]') as HTMLElement
  expect(within(row).queryByRole('button', { name: 'Expand row' })).not.toBeInTheDocument()

  await userEvent.click(within(row).getByRole('button', { name: /Open conversation/ }))
  expect(onOpenConversation).toHaveBeenCalledWith('conversation-1')
})

it('aggregates duplicate conversation titles and keeps each real conversation as an expandable child', async () => {
  const firstId = 'deadbeef-0000-4000-8000-000000000001'
  const secondId = 'deadbeef-0000-4000-8000-000000000002'
  serve({
    total: [bucket()],
    conversation: [
      bucket({
        key: firstId,
        label: 'Repeated title',
        messages: 2,
        input_tokens: 1_000,
        output_tokens: 500,
        total_cost: decimal('1'),
        unpriced_messages: 1,
      }),
      bucket({
        key: secondId,
        label: 'Repeated title',
        messages: 3,
        input_tokens: 2_000,
        output_tokens: 500,
        total_cost: decimal('2'),
        unpriced_messages: 2,
      }),
      bucket({ key: 'gone', label: null, total_cost: decimal('0.5') }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const grid = await screen.findByRole('treegrid', { name: 'Breakdown: Conversation' })
  const parentHeader = within(grid).getByRole('rowheader', { name: /Repeated title/ })
  const parentRow = parentHeader.closest('[role="row"]') as HTMLElement
  expect(within(parentRow).getByText('2 conversations · 5 replies')).toBeInTheDocument()
  expect(within(parentRow).getByText('4K')).toBeInTheDocument()
  expect(within(parentRow).getByText('≥ 3.00')).toHaveAttribute(
    'title',
    '3 replies have incomplete usage or pricing. Amounts marked ≥ include only the priced portion.',
  )
  expect(within(parentRow).queryByRole('button', { name: /Open conversation/ })).not.toBeInTheDocument()

  await userEvent.click(within(parentRow).getByRole('button', { name: /^Expand row/ }))

  const childHeaders = await within(grid).findAllByRole('rowheader', { name: 'Conversation deadbeef' })
  expect(childHeaders).toHaveLength(2)
  const secondOpen = within(grid).getByRole('button', {
    name: `Open conversation “Repeated title” (${secondId})`,
  })
  await userEvent.click(secondOpen)
  expect(onOpenConversation).toHaveBeenCalledWith(secondId)

  const deletedHeader = within(grid).getByRole('rowheader', { name: 'Deleted' })
  const deletedRow = deletedHeader.closest('[role="row"]') as HTMLElement
  expect(within(deletedRow).queryByRole('button', { name: /Open conversation/ })).not.toBeInTheDocument()
})

it('keeps an existing conversation with an empty title openable and falls back to its full id', async () => {
  const conversationId = 'untitled-conversation-id'
  serve({
    total: [bucket()],
    conversation: [bucket({ key: conversationId, label: '' })],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const grid = await screen.findByRole('treegrid', { name: 'Breakdown: Conversation' })
  const rowHeader = within(grid).getByRole('rowheader', { name: conversationId })
  const row = rowHeader.closest('[role="row"]') as HTMLElement
  const open = within(row).getByRole('button', {
    name: `Open conversation “${conversationId}” (${conversationId})`,
  })

  expect(within(row).queryByText('Deleted')).not.toBeInTheDocument()
  await userEvent.click(open)
  expect(onOpenConversation).toHaveBeenCalledWith(conversationId)
})

it('groups every matching title before limiting the table to twelve visible rows', async () => {
  const unique = Array.from({ length: 12 }, (_, index) =>
    bucket({ key: `unique-${index}`, label: `Unique ${index}`, total_cost: decimal((20 - index).toString()) }),
  )
  serve({
    total: [bucket()],
    // Each duplicate is below the old top-twelve cut. Together they rank near
    // the top, so seeing the parent proves grouping happened before slicing.
    conversation: [
      ...unique,
      bucket({ key: 'duplicate-a', label: 'Combined title', total_cost: decimal('8') }),
      bucket({ key: 'duplicate-b', label: 'Combined title', total_cost: decimal('8') }),
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const grid = await screen.findByRole('treegrid', { name: 'Breakdown: Conversation' })
  expect(within(grid).getByRole('rowheader', { name: /Combined title/ })).toBeInTheDocument()
  expect(within(grid).queryByRole('rowheader', { name: 'Unique 11' })).not.toBeInTheDocument()
})

it('ranks equal-cost conversation rows by tokens and then preserves backend order', async () => {
  const equalCost = Array.from({ length: 13 }, (_, index) =>
    bucket({
      key: `equal-${index}`,
      label: `Equal ${index}`,
      input_tokens: 1_000,
      output_tokens: 500,
      total_cost: decimal('1'),
    }),
  )
  serve({
    total: [bucket()],
    conversation: [
      bucket({
        key: 'low-tokens',
        label: 'Low tokens',
        input_tokens: 1,
        output_tokens: 0,
        total_cost: decimal('1'),
      }),
      ...equalCost,
    ],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  const grid = await screen.findByRole('treegrid', { name: 'Breakdown: Conversation' })
  expect(within(grid).queryByRole('rowheader', { name: 'Low tokens' })).not.toBeInTheDocument()
  expect(within(grid).getByRole('rowheader', { name: 'Equal 0' })).toBeInTheDocument()
  expect(within(grid).queryByRole('rowheader', { name: 'Equal 12' })).not.toBeInTheDocument()
})

it('uses the bot account key instead of calling a normal account deleted', async () => {
  serve({
    total: [bucket()],
    conversation: [bucket()],
    bot: [bucket({ key: '10001', label: null })],
  })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)

  await userEvent.click(await screen.findByRole('tab', { name: 'Bot account' }))

  const grid = await screen.findByRole('grid', { name: 'Breakdown: Bot account' })
  expect(within(grid).getByRole('rowheader', { name: '10001' })).toBeInTheDocument()
  expect(within(grid).queryByText('Deleted')).not.toBeInTheDocument()
})

it('narrows the window without reloading the whole page', async () => {
  serve({ total: [bucket()] })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)
  await screen.findByText('Cost', { selector: '[data-slot="kpi-title"]' })

  const sent = (): UsageReportRequest | null =>
    (mockApi.usageReport.mock.calls.at(-1)?.[0] as UsageReportRequest | undefined) ?? null
  const thirtyDays = sent()?.sinceMs ?? 0

  await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))

  await waitFor(() => expect(sent()?.sinceMs ?? 0).toBeGreaterThan(thirtyDays))
})

it('asks for the whole log when the range is cleared', async () => {
  serve({ total: [bucket()] })
  render(<UsageSettings onOpenConversation={onOpenConversation} />)
  await screen.findByText('Cost', { selector: '[data-slot="kpi-title"]' })

  await userEvent.click(screen.getByRole('button', { name: 'All time' }))

  await waitFor(() => {
    const request = mockApi.usageReport.mock.calls.at(-1)?.[0] as UsageReportRequest
    expect(request.sinceMs).toBeNull()
  })
})
