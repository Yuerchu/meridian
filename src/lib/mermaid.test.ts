import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderMermaid, svgToImage } from './mermaid'

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: mermaid }))

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
    mermaid.initialize.mockReset()
    mermaid.render.mockReset()
  })

  // The diagram is model output; strict is Mermaid's own sanitising.
  it('draws in strict mode, in the theme asked for, with the system font', async () => {
    mermaid.render.mockResolvedValue({ svg: SVG })
    const image = await renderMermaid('flowchart LR\n  A --> B', 'dark')

    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        theme: 'dark',
        startOnLoad: false,
        fontFamily: 'system-ui, sans-serif',
      }),
    )
    expect(image.src.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('passes a parse error on, and clears what the failed render left in the page', async () => {
    mermaid.render.mockImplementation(async (id: string) => {
      const scratch = document.createElement('div')
      scratch.id = `d${id}`
      document.body.append(scratch)
      throw new Error('Parse error on line 2')
    })

    await expect(renderMermaid('flowchart LR\n  A -->', 'light')).rejects.toThrow('Parse error on line 2')
    expect(document.querySelector('[id^="dmeridian-mermaid"]')).toBeNull()
  })
})
