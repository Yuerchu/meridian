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

import { ThinkingRow, separateSummaryParts } from './thinking-block'

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

describe('ThinkingRow', () => {
  it('is a badge that opens the thought inline, rendered as Markdown', () => {
    render(<ThinkingRow text={'**Filtering endpoint findings**\n\nOnly the auth ones.'} panelKey="m1:0:thinking" />)
    const badge = screen.getByRole('button', { name: /chat\.thinking/ })
    expect(badge).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Filtering endpoint findings')).toBeNull()

    fireEvent.click(badge)
    expect(badge).toHaveAttribute('aria-expanded', 'true')
    // Bold, not a line of asterisks.
    const title = screen.getByText('Filtering endpoint findings')
    expect(title.tagName).toBe('STRONG')
    expect(screen.getByText('Only the auth ones.')).toBeInTheDocument()
  })

  it('shows summary-only reasoning as separate titles', () => {
    render(<ThinkingRow text="**One****Two**" panelKey="m1:1:thinking" />)
    fireEvent.click(screen.getByRole('button', { name: /chat\.thinking/ }))
    expect(screen.getByText('One').tagName).toBe('STRONG')
    expect(screen.getByText('Two').tagName).toBe('STRONG')
  })

  it('is open while the thought is still arriving', () => {
    render(<ThinkingRow text="so far" panelKey="m1:2:thinking" isStreaming />)
    expect(screen.getByRole('button', { name: /chat\.thinking/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('so far')).toBeInTheDocument()
  })
})
