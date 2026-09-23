import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(() => Promise.resolve()) }))
vi.mock('@/api', () => ({
  api: {
    getPlatform: vi.fn(() => Promise.resolve('windows')),
    workspaceReadFile: vi.fn(),
    workspaceResolveRef: vi.fn(),
    workspaceProbeRef: vi.fn(() => Promise.resolve(null)),
    openInEditor: vi.fn(() => Promise.resolve()),
  },
}))

import { ThinkingRow, separateSummaryParts, shapeOfThinking } from './thinking-block'

describe('separateSummaryParts', () => {
  it('reopens the seam between two summary parts written without one', () => {
    expect(separateSummaryParts('**Checking staleness****Locating constants**')).toBe(
      '**Checking staleness**\n\n**Locating constants**',
    )
  })
  it('leaves ordinary prose alone', () => {
    expect(separateSummaryParts('**bold** and *italic* and ***both***')).toBe('**bold** and *italic* and ***both***')
  })
})

describe('shapeOfThinking', () => {
  it('reads a run of titles as titles and nothing else', () => {
    expect(shapeOfThinking('**One****Two**\n\n**Three**')).toEqual({ titles: ['One', 'Two', 'Three'], hasProse: false })
  })
  it('reads a title over a body as prose', () => {
    expect(shapeOfThinking('**Filtering**\n\nOnly the auth ones.')).toEqual({ titles: ['Filtering'], hasProse: true })
  })
  it('reads a plain thought as prose', () => {
    expect(shapeOfThinking('let me see')).toEqual({ titles: [], hasProse: true })
  })
})

describe('ThinkingRow', () => {
  it('shows a summary that is only titles as a persistent status line', () => {
    const { container } = render(<ThinkingRow text="**Checking available references**" panelKey="m1:0:thinking" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Checking available references')).toBeInTheDocument()
    expect(container.querySelector('[data-shape="titles"]')).not.toBeNull()
  })

  it('shimmers the latest title while the thought is still arriving', () => {
    const { container } = render(<ThinkingRow text="**One****Two**" panelKey="m1:1:thinking" isStreaming />)
    // boardui's `ShimmerText` (agent-log) is the class, not a data-slot.
    const shimmer = container.querySelector('.agent-progress-loading-text')
    expect(shimmer?.textContent).toBe('Two')
    expect(screen.getByText('One').closest('.agent-progress-loading-text')).toBeNull()
  })

  it('folds a thought with a body behind a badge and draws it as small Markdown', () => {
    render(<ThinkingRow text={'**Filtering endpoint findings**\n\nOnly the auth ones.'} panelKey="m1:2:thinking" />)
    const badge = screen.getByRole('button', { name: /chat\.thinking/ })
    expect(badge).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Filtering endpoint findings')).toBeNull()

    fireEvent.click(badge)
    expect(badge).toHaveAttribute('aria-expanded', 'true')
    const title = screen.getByText('Filtering endpoint findings')
    expect(title.tagName).toBe('STRONG')
    const panel = title.closest('[data-slot="markdown-content"]')
    expect(panel?.className).toContain('text-caption-1-regular')
    expect(panel?.className).toContain('text-text-secondary')
    expect(screen.getByText('Only the auth ones.')).toBeInTheDocument()
  })

  it('is open while a thought with a body is still arriving', () => {
    render(<ThinkingRow text="so far, and then some more" panelKey="m1:3:thinking" isStreaming />)
    expect(screen.getByRole('button', { name: /chat\.thinking/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('so far, and then some more')).toBeInTheDocument()
  })
})
