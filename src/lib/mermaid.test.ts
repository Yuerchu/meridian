import { beforeEach, describe, expect, it, vi } from 'vitest'

import { errorMessage } from './error-message'
import { renderMermaid, svgToImage } from './mermaid'

const sandboxRenderer = vi.hoisted(() => vi.fn())
vi.mock('./mermaid-sandbox', () => ({ sandboxRenderer }))

/** What Mermaid writes: a fluid width, a max-width style, and the laid-out size in the view box. */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 721.375px;" viewBox="0 0 721.375 150"><g/></svg>'

function parsed(src: string): Element {
  const markup = decodeURIComponent(src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
  return new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
}

describe('svgToImage', () => {
  // As an image, `width="100%"` has nothing to be a percentage of.
  it('gives the image the size it was laid out at', () => {
    const image = svgToImage(SVG)
    expect(image).toMatchObject({ width: 721.375, height: 150 })
    const root = parsed(image.src)
    expect(root.getAttribute('width')).toBe('721.375')
    expect(root.getAttribute('height')).toBe('150')
    expect(root.getAttribute('style') ?? '').not.toContain('max-width')
  })

  it('refuses an SVG with no view box rather than guessing a size', () => {
    expect(() => svgToImage('<svg xmlns="http://www.w3.org/2000/svg" width="100%"><g/></svg>')).toThrow(/view box/)
  })
})

describe('renderMermaid', () => {
  beforeEach(() => {
    sandboxRenderer.mockReset()
  })

  it('hands the code to the frame and shows what comes back as an image', async () => {
    const render = vi.fn().mockResolvedValue(SVG)
    sandboxRenderer.mockResolvedValue(render)

    const image = await renderMermaid('flowchart LR\n  A --> B', 'dark')

    expect(render).toHaveBeenCalledWith('flowchart LR\n  A --> B', 'dark')
    expect(image.src.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('fails with the reason the sandbox gave', async () => {
    sandboxRenderer.mockResolvedValue(vi.fn().mockRejectedValue(new Error('Parse error on line 2')))
    const error = await renderMermaid('flowchart LR\n  A -->', 'light').catch((e: unknown) => e)
    expect(errorMessage(error)).toBe('Parse error on line 2')
  })

  it('never draws a diagram withdrawn while it waited its turn', async () => {
    let finishFirst!: (svg: string) => void
    const render = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => (finishFirst = resolve)))
      .mockResolvedValue(SVG)
    sandboxRenderer.mockResolvedValue(render)

    const first = renderMermaid('flowchart LR\n  A --> B', 'light')
    const controller = new AbortController()
    const second = renderMermaid('flowchart LR\n  C --> D', 'light', controller.signal)
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    controller.abort()
    finishFirst(SVG)

    await expect(first).resolves.toMatchObject({ width: 721.375 })
    await expect(second).rejects.toThrow()
    expect(render).toHaveBeenCalledTimes(1)
  })
})
