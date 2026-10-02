import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { errorMessage } from './error-message'
import { renderMermaid, svgToImage } from './mermaid'

const frameRenderer = vi.hoisted(() => vi.fn())
vi.mock('./mermaid-frame-host', () => ({ frameRenderer }))

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
    frameRenderer.mockReset()
  })

  it('hands the code to the frame and shows what comes back as an image', async () => {
    const render = vi.fn().mockResolvedValue(SVG)
    frameRenderer.mockResolvedValue(render)

    const image = await renderMermaid('flowchart LR\n  A --> B', 'dark')

    expect(render).toHaveBeenCalledWith('flowchart LR\n  A --> B', 'dark')
    expect(image.src.startsWith('data:image/svg+xml')).toBe(true)
  })

  // An error thrown in the frame is from another realm: `instanceof Error` is
  // false here, and String() would prefix "Error: " to the reason.
  it('carries the reason of a failure in the frame across as plain text', async () => {
    frameRenderer.mockResolvedValue(vi.fn().mockRejectedValue({ message: 'Parse error on line 2' }))
    const error = await renderMermaid('flowchart LR\n  A -->', 'light').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(errorMessage(error)).toBe('Parse error on line 2')
  })

  it('never draws a diagram withdrawn while it waited its turn', async () => {
    let finishFirst!: (svg: string) => void
    const render = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => (finishFirst = resolve)))
      .mockResolvedValue(SVG)
    frameRenderer.mockResolvedValue(render)

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

/**
 * The frame's CSP is the wall between a diagram and the network: laid out in
 * the app, `A@{ img: "https://…" }` fetched its URL. Measured in Chromium with
 * the policy below, an image node, an `<img>` label and a `url()` in an
 * `%%{init}%%` theme each failed with `csp` and none reached the network.
 */
describe('mermaid-frame.html', () => {
  const html = readFileSync('mermaid-frame.html', 'utf8')
  const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''

  it('fetches nothing but its own scripts', () => {
    const directives = Object.fromEntries(
      policy
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .filter((d) => d[0])
        .map(([name, ...sources]) => [name, sources]),
    )
    expect(directives['default-src']).toEqual(["'none'"])
    expect(directives['script-src']).toEqual(["'self'"])
    expect(directives['img-src']).toEqual(['data:'])
    expect(directives['style-src']).toEqual(["'unsafe-inline'"])
    expect(Object.keys(directives).sort()).toEqual(['default-src', 'img-src', 'script-src', 'style-src'])
  })
})
