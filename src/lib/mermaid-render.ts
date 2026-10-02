import type { Mermaid } from 'mermaid'

/**
 * The render that runs inside `mermaid-frame.html`, apart from the app.
 *
 * `securityLevel: 'strict'` is Mermaid's own sanitising and drops click
 * handlers. `system-ui` because the parent shows the result as an image, which
 * cannot load the app's fonts, and Mermaid sizes each label's box from what it
 * measured here — measured and drawn in one installed face, the labels fit.
 */
export const MERMAID_FONT = 'system-ui, sans-serif'

export type MermaidTheme = 'light' | 'dark'

export type FrameRenderer = (code: string, theme: MermaidTheme) => Promise<string>

declare global {
  interface Window {
    meridianRenderMermaid?: FrameRenderer
  }
}

export function createRenderer(mermaid: Mermaid): FrameRenderer {
  let sequence = 0
  return async (code, theme) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: MERMAID_FONT,
      themeVariables: { fontFamily: MERMAID_FONT },
    })
    try {
      const { svg } = await mermaid.render(`diagram-${++sequence}`, code)
      return svg
    } finally {
      // Mermaid lays out in the body and a failed render can leave that behind.
      // Nothing else lives in this document.
      document.body.replaceChildren()
    }
  }
}
