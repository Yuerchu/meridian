import { render, waitFor } from '@testing-library/react'
import { RichTextEditor } from './rich-text-editor'

describe('RichTextEditor.Content', () => {
  // Typography's default wraps inline code in literal backticks through
  // `::before`/`::after`; jsdom draws no pseudo-elements, so what is pinned is
  // the recipe that switches them off (plan review showed `export_bundle`
  // with its backticks on screen, 2026-09).
  it('draws inline code without the typography backticks', async () => {
    const { container } = render(
      <RichTextEditor defaultValue="<p>Add <code>export_bundle</code></p>">
        <RichTextEditor.Content />
      </RichTextEditor>,
    )
    await waitFor(() => expect(container.querySelector('code')).toHaveTextContent('export_bundle'))
    const content = container.querySelector('[data-slot="rich-text-editor-content"]')!
    expect(content).toHaveClass('prose', 'prose-code:before:content-none', 'prose-code:after:content-none')
  })
})
