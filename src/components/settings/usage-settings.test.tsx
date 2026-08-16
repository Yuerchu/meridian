import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsageSettings } from './usage-settings'
// Imported for the side effect of initialising i18next. Without it every `t()`
// returns its key, and the two range buttons — one key, two counts — become
// indistinguishable to a query by name.
import '@/i18n'
import { api } from '@/api'
import type { UsageBucket, UsageDimension, UsageFilter } from '@/types'

vi.mock('@/api', () => ({ api: { usageReport: vi.fn() } }))

const mockApi = vi.mocked(api)

function bucket(over: Partial<UsageBucket> = {}): UsageBucket {
  return {
    key: 'k',
    label: 'A conversation',
    messages: 4,
    input_tokens: 1_000,
    output_tokens: 500,
    cache_read_tokens: 250,
    cache_write_tokens: 0,
    cost: 1.5,
    unpriced_messages: 0,
    ...over,
  }
}

/** Answers each of the five groupings the panel asks for. */
function serve(by: Partial<Record<UsageDimension, UsageBucket[]>>) {
  mockApi.usageReport.mockImplementation((dimension: UsageDimension) =>
    Promise.resolve(by[dimension] ?? []),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * The one claim this page must never make quietly. A model with no price
 * contributes tokens and no cost, so a total shown on its own is smaller than
 * the truth with nothing to say so.
 */
it('says so when part of the traffic could not be priced', async () => {
  serve({ total: [bucket({ messages: 10, unpriced_messages: 4, cost: 2 })] })
  render(<UsageSettings />)

  expect(await screen.findByText(/4/)).toBeInTheDocument()
  await waitFor(() => {
    expect(document.querySelector('[data-slot="unpriced-warning"]')).not.toBeNull()
  })
})

it('keeps the warning off when everything has a price', async () => {
  serve({ total: [bucket({ unpriced_messages: 0 })] })
  render(<UsageSettings />)

  await screen.findByText('Cost')
  expect(document.querySelector('[data-slot="unpriced-warning"]')).toBeNull()
})

/**
 * Zero prompt tokens is no data, not a total cache miss. Dividing anyway prints
 * "0.0%", which is a claim about the provider rather than about the absence of
 * one.
 */
it('shows a dash for the hit rate rather than dividing by nothing', async () => {
  serve({ total: [bucket({ messages: 2, input_tokens: 0, cache_read_tokens: 0 })] })
  render(<UsageSettings />)

  expect(await screen.findByText('—')).toBeInTheDocument()
})

/**
 * The prompt is drawn as the parts that cost different amounts. The cache
 * figures are subsets of `input_tokens`, so a band for the full input beside a
 * band for the cached part would draw the cached tokens twice.
 */
it('splits the prompt into what missed cache and what did not', async () => {
  serve({ total: [bucket()], day: [bucket({ key: '2026-08-13' })] })
  render(<UsageSettings />)

  expect(await screen.findByText('Input · uncached')).toBeInTheDocument()
  expect(screen.getByText('Input · cache hit')).toBeInTheDocument()
  expect(screen.getByText('Output')).toBeInTheDocument()
})

/**
 * Cache writes are zero on every provider but Anthropic. A legend entry the
 * reader can never find in the chart is worse than one band fewer.
 */
it('leaves out a band that is zero everywhere', async () => {
  serve({ total: [bucket()], day: [bucket({ cache_write_tokens: 0 })] })
  render(<UsageSettings />)

  await screen.findByText('Input · uncached')
  expect(screen.queryByText('Input · cache write')).toBeNull()
})

it('draws the cache write band once there is one', async () => {
  serve({
    total: [bucket()],
    day: [bucket({ input_tokens: 1_000, cache_read_tokens: 200, cache_write_tokens: 300 })],
  })
  render(<UsageSettings />)

  expect(await screen.findByText('Input · cache write')).toBeInTheDocument()
})

/** A row whose subject has been deleted keeps its cost and loses its name. */
it('names a deleted row as deleted instead of dropping it', async () => {
  serve({
    total: [bucket()],
    conversation: [bucket({ key: 'gone', label: null })],
  })
  render(<UsageSettings />)

  expect(await screen.findByText('Deleted')).toBeInTheDocument()
})

it('narrows the window without reloading the whole page', async () => {
  serve({ total: [bucket()] })
  render(<UsageSettings />)
  await screen.findByText('Cost')

  const sent = (): UsageFilter | null =>
    (mockApi.usageReport.mock.calls.at(-1)?.[1] as UsageFilter | undefined) ?? null
  const thirtyDays = sent()?.since_ms ?? 0

  await userEvent.click(screen.getByRole('tab', { name: 'Last 7 days' }))

  await waitFor(() => expect(sent()?.since_ms ?? 0).toBeGreaterThan(thirtyDays))
})

it('asks for the whole log when the range is cleared', async () => {
  serve({ total: [bucket()] })
  render(<UsageSettings />)
  await screen.findByText('Cost')

  await userEvent.click(screen.getByRole('tab', { name: 'All time' }))

  await waitFor(() => {
    const filter = mockApi.usageReport.mock.calls.at(-1)?.[1] as UsageFilter
    expect(filter.since_ms).toBeNull()
  })
})
