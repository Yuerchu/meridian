import { frameRenderer } from './mermaid-frame-host'
import type { MermaidTheme } from './mermaid-render'

/**
 * A ```mermaid fence, drawn as a picture.
 *
 * The diagram is the model's output, which makes it untrusted input, and an
 * XSS in this WebView reaches every Tauri command. There are two stages and
 * each has its wall.
 *
 * **Laying out** needs a live document — Mermaid measures every label — and a
 * live document fetches what is in it: run in the app, a node written
 * `A@{ img: "https://…" }` requested its URL while the diagram was being
 * measured, a beacon any answer could plant, and `url()` in a style or an
 * `%%{init}%%` theme is another way to the same place. So Mermaid does not run
 * in the app at all. It runs in `mermaid-frame.html`, a same-origin page whose
 * CSP lets it fetch its own scripts and nothing else; this module hands it the
 * code and gets back a string (`mermaid-frame-host.ts`, `mermaid-render.ts`).
 * Rendering into a container in another document was tried first and does not
 * work: the flowchart renderer looks its SVG up with `select('#id')`, which
 * searches the global document.
 *
 * **Showing** is an `<img>` from a `data:` URL rather than SVG placed in the
 * page: an SVG used as an image runs no script and loads nothing, by
 * specification, whatever is inside it.
 *
 * The frame is its own build entry, so Mermaid (3 MB) is fetched only when a
 * diagram is first drawn.
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
    const render = await frameRenderer()
    signal?.throwIfAborted()
    let svg: string
    try {
      svg = await render(code, theme)
    } catch (reason) {
      // Thrown in the frame's realm, where `instanceof Error` against this
      // one's is false: carry the message across, not the object.
      const message = (reason as { message?: unknown } | null)?.message
      throw Object.assign(new Error(typeof message === 'string' ? message : String(reason)), { cause: reason })
    }
    return svgToImage(svg)
  })
  queue = job.catch(() => undefined)
  return job
}
