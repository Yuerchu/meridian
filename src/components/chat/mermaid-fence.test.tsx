import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { ThemeProvider } from '@/lib/theme'
import { MarkdownContent } from './markdown-content'

const renderMermaid = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mermaid', () => ({ renderMermaid }))

const FENCE = '```mermaid\nflowchart LR\n  A --> B\n```'
const IMAGE = { src: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E', width: 120, height: 40 }

function show(content: string, isStreaming = false) {
  return render(
    <ThemeProvider>
      <MarkdownContent content={content} isStreaming={isStreaming} />
    </ThemeProvider>,
  )
}

describe('a mermaid fence', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    renderMermaid.mockReset()
  })

  it('is drawn as an image, with its source one switch away', async () => {
    const user = userEvent.setup()
    renderMermaid.mockResolvedValue(IMAGE)
    show(FENCE)

    const diagram = await screen.findByRole('img', { name: 'Mermaid diagram' })
    expect(diagram).toHaveAttribute('src', IMAGE.src)
    expect(renderMermaid).toHaveBeenCalledWith('flowchart LR\n  A --> B', expect.stringMatching(/^(light|dark)$/))

    await user.click(screen.getByRole('radio', { name: 'Source' }))
    expect(screen.queryByRole('img', { name: 'Mermaid diagram' })).toBeNull()
    expect(screen.getByText(/flowchart LR/)).toBeInTheDocument()
  })

  // Half a diagram is a parse error on every chunk.
  it('stays code while the answer is still streaming', () => {
    show(FENCE, true)
    expect(renderMermaid).not.toHaveBeenCalled()
    expect(screen.getByText(/flowchart LR/)).toBeInTheDocument()
  })

  it('shows its source and the reason when it will not draw', async () => {
    renderMermaid.mockRejectedValue(new Error('Parse error on line 2'))
    show(FENCE)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not draw the diagram: Parse error on line 2')
    expect(screen.getByText(/flowchart LR/)).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Diagram' })).toBeNull()
  })
})
