import type { FrameRenderer } from './mermaid-render'

let frame: Promise<FrameRenderer> | null = null

/**
 * The renderer in `mermaid-frame.html`, loading the frame the first time.
 *
 * One frame, kept for the session: it holds Mermaid, which is loaded once, and
 * it is hidden rather than removed between diagrams. Off screen rather than
 * `display: none` — Mermaid measures text, and a document that is not rendered
 * measures every label as zero. A frame that fails to start is dropped, so the
 * next diagram tries again instead of inheriting the failure.
 */
export function frameRenderer(): Promise<FrameRenderer> {
  frame ??= new Promise<FrameRenderer>((resolve, reject) => {
    const el = document.createElement('iframe')
    el.setAttribute('aria-hidden', 'true')
    el.tabIndex = -1
    el.style.cssText = 'position:fixed;left:-10000px;top:0;width:1600px;height:1200px;border:0;visibility:hidden'
    el.addEventListener(
      'load',
      () => {
        const render = el.contentWindow?.meridianRenderMermaid
        if (render) {
          resolve(render)
          return
        }
        el.remove()
        reject(new Error('The diagram renderer did not start'))
      },
      { once: true },
    )
    el.src = '/mermaid-frame.html'
    document.body.append(el)
  }).catch((reason: unknown) => {
    frame = null
    throw reason
  })
  return frame
}
