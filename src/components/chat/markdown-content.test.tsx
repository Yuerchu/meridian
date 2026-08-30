import { fireEvent, render, screen } from '@testing-library/react'

import { MarkdownContent } from './markdown-content'

describe('MarkdownContent images', () => {
  it('reserves a stable frame and lazy-loads remote content', async () => {
    const { container } = render(<MarkdownContent content="![Architecture diagram](https://example.com/image.png)" />)

    const image = await screen.findByRole('img', { name: 'Architecture diagram' })
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(image).not.toHaveAttribute('width')
    expect(image).not.toHaveAttribute('height')
    expect(image.className).toContain('h-auto')
    expect(image.className).toContain('max-w-full')

    const frame = container.querySelector('[data-slot="markdown-image-frame"]')!
    expect(frame.className).not.toContain('aspect-video')
    expect(Array.from(frame.classList)).not.toContain('w-full')
    expect(frame).toContainElement(image)
    fireEvent.load(image)
    expect(frame).toHaveAttribute('data-loaded', 'true')
  })
})
