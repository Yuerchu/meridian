import { sandboxRenderer, type MermaidTheme } from './mermaid-sandbox'

/**
 * A ```mermaid fence, drawn as a picture.
 *
 * The diagram is the model's output, and the model's output is whatever the
 * vendor in between chose to send: a relay can rewrite any answer and aim it
 * at a renderer's known holes. So Mermaid is treated as code that may be
 * subverted, and is given nothing worth having when it is.
 *
 * **It runs in a sandbox** (`mermaid-sandbox.ts`): an iframe with
 * `sandbox="allow-scripts"` and no `allow-same-origin`, so an opaque origin
 * that cannot read this window or reach a Tauri command; a CSP that admits its
 * two scripts by hash and nothing else — no network, no injected `onerror=`;
 * and one message shape each way. Two earlier versions were not enough. Laid
 * out in the app, `A@{ img: "https://…" }` made the WebView fetch the URL.
 * In a same-origin frame with a network CSP, code that got running there could
 * still walk to `window.parent`.
 *
 * **It is shown as an `<img>`** from a `data:` URL rather than SVG placed in
 * the page: an SVG used as an image runs no script and loads nothing, by
 * specification, whatever the sandbox sent back.
 *
 * Mermaid's single-file build is a lazy chunk, fetched only when a diagram is
 * first drawn.
 */

export interface MermaidImage {
  src: string
  width: number
  height: number
}

// Mermaid keeps its configuration globally: two renders at once can each draw
// with the other's theme. One at a time.
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

/**
 * Draws one fence. `signal` withdraws a render still waiting its turn — one
 * whose fence was scrolled away, re-themed or rewritten before the renders
 * ahead of it finished — so it never reaches Mermaid.
 */
export function renderMermaid(code: string, theme: MermaidTheme, signal?: AbortSignal): Promise<MermaidImage> {
  const job = queue.then(async () => {
    signal?.throwIfAborted()
    const render = await sandboxRenderer()
    signal?.throwIfAborted()
    return svgToImage(await render(code, theme))
  })
  queue = job.catch(() => undefined)
  return job
}
