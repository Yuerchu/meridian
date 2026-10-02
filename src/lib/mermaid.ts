/**
 * A ```mermaid fence, drawn as a picture.
 *
 * Mermaid is loaded on first use (`import()`), so the 3 MB library is its own
 * chunk and an app that is never shown a diagram never fetches it.
 *
 * The diagram is the model's output, which makes it untrusted input, and an
 * XSS in this WebView reaches every Tauri command. So two walls, either of
 * which would do alone: `securityLevel: 'strict'` (Mermaid's own sanitising,
 * no click handlers), and the SVG is shown as an `<img>` from a `data:` URL
 * rather than placed in the page — an SVG used as an image runs no script
 * and loads nothing, by specification, whatever is inside it. Mermaid has
 * shipped XSS fixes before; the second wall is there for the next one.
 *
 * What the image costs is the page's fonts: it cannot load them. Mermaid
 * measures each label in the page and sizes its box to fit, so a label drawn
 * in a different font than it was measured in overflows its box. Both sides
 * therefore use `system-ui`, which resolves to the same installed face in the
 * page and in the image.
 */

const FONT = 'system-ui, sans-serif'

export interface MermaidImage {
  src: string
  width: number
  height: number
}

let sequence = 0
// Mermaid keeps its configuration, and the element it measures in, globally:
// two renders at once can each draw with the other's theme. One at a time.
let queue: Promise<unknown> = Promise.resolve()

/**
 * The SVG as an image source with its own size. Mermaid writes `width="100%"`
 * and a `max-width` style, which as an image has no intrinsic size to fall
 * back on; the view box is the size it was laid out at.
 */
export function svgToImage(svg: string): MermaidImage {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  const box = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (root.nodeName !== 'svg' || !box || box.length !== 4 || box.some((n) => !Number.isFinite(n))) {
    throw new Error('Mermaid did not produce an SVG with a view box')
  }
  const [, , width, height] = box
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.style.removeProperty('max-width')
  const markup = new XMLSerializer().serializeToString(root)
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, width, height }
}

export function renderMermaid(code: string, theme: 'light' | 'dark'): Promise<MermaidImage> {
  const job = queue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: FONT,
      themeVariables: { fontFamily: FONT },
    })
    const id = `meridian-mermaid-${++sequence}`
    try {
      const { svg } = await mermaid.render(id, code)
      return svgToImage(svg)
    } finally {
      // A failed render can leave its scratch element in the body.
      document.getElementById(`d${id}`)?.remove()
      document.getElementById(id)?.remove()
    }
  })
  queue = job.catch(() => undefined)
  return job
}
