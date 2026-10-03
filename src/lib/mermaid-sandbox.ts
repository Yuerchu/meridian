export type MermaidTheme = 'light' | 'dark'

/** Hands one diagram to the sandbox and answers with Mermaid's SVG. */
export type SandboxRenderer = (code: string, theme: MermaidTheme) => Promise<string>

/**
 * Longer than any real layout. A sandbox that has not answered by then has
 * crashed or hung, and the fence says so instead of waiting for ever.
 */
const ANSWER_TIMEOUT_MS = 30_000

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return `sha256-${btoa(binary)}`
}

/** A script's text as it may sit inside `<script>`: no early end tag. */
function inlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script')
}

/**
 * The sandbox's document: Mermaid's single-file build, then the bridge, and a
 * CSP that admits those two scripts by hash and nothing else — no network at
 * all, no other inline script, no `onerror=` an injected element might carry.
 * The hashes are of the text exactly as it sits in the document.
 */
export async function sandboxDocument(library: string, bridge: string): Promise<string> {
  const scripts = [inlineScript(library), inlineScript(bridge)]
  const hashes = await Promise.all(scripts.map(sha256))
  const policy = `default-src 'none'; script-src ${hashes.map((h) => `'${h}'`).join(' ')}; style-src 'unsafe-inline'; img-src data:`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body>${scripts.map((s) => `<script>${s}</script>`).join('')}</body></html>`
}

type Answer = { id: number; svg: string } | { id: number; error: string }

/** The two shapes the bridge sends; anything else from the frame is ignored. */
export function parseAnswer(data: unknown): Answer | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const keys = Object.keys(data).sort().join(',')
  const value = data as Record<string, unknown>
  if (typeof value.id !== 'number') return null
  if (keys === 'id,svg' && typeof value.svg === 'string') return { id: value.id, svg: value.svg }
  if (keys === 'error,id' && typeof value.error === 'string') return { id: value.id, error: value.error }
  return null
}

function isReady(data: unknown): boolean {
  return (
    !!data &&
    typeof data === 'object' &&
    Object.keys(data).join(',') === 'ready' &&
    (data as { ready: unknown }).ready === true
  )
}

async function start(): Promise<SandboxRenderer> {
  const [{ default: library }, { default: bridge }] = await Promise.all([
    import('mermaid/dist/mermaid.min.js?raw'),
    import('./mermaid-bridge.js?raw'),
  ])
  const srcdoc = await sandboxDocument(library, bridge)

  const frame = document.createElement('iframe')
  // `allow-scripts` without `allow-same-origin`: an opaque origin, which can
  // neither read this window nor be read by it, and reaches no Tauri command.
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  // Off screen rather than `display: none`: Mermaid measures text, and a
  // document that is not rendered measures every label as zero.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1600px;height:1200px;border:0;visibility:hidden'

  const waiting = new Map<number, { resolve: (svg: string) => void; reject: (e: Error) => void; timer: number }>()
  let started!: () => void
  const ready = new Promise<void>((resolve) => (started = resolve))
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return
    if (isReady(event.data)) {
      started()
      return
    }
    const answer = parseAnswer(event.data)
    const request = answer && waiting.get(answer.id)
    if (!answer || !request) return
    waiting.delete(answer.id)
    window.clearTimeout(request.timer)
    if ('svg' in answer) request.resolve(answer.svg)
    else request.reject(new Error(answer.error))
  }
  window.addEventListener('message', onMessage)
  frame.srcdoc = srcdoc
  document.body.append(frame)

  let timer = 0
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('The diagram sandbox did not start')), ANSWER_TIMEOUT_MS)
      }),
    ])
  } catch (reason) {
    window.removeEventListener('message', onMessage)
    frame.remove()
    throw reason
  } finally {
    window.clearTimeout(timer)
  }

  let lastId = 0
  return (code, theme) =>
    new Promise<string>((resolve, reject) => {
      const id = ++lastId
      const timer = window.setTimeout(() => {
        waiting.delete(id)
        reject(new Error('The diagram sandbox did not answer'))
      }, ANSWER_TIMEOUT_MS)
      waiting.set(id, { resolve, reject, timer })
      // '*' because an opaque origin has no name to address it by; the frame
      // is the one window this can reach.
      frame.contentWindow?.postMessage({ id, code, theme }, '*')
    })
}

let sandbox: Promise<SandboxRenderer> | null = null

/**
 * The sandbox, started the first time a diagram is drawn and kept for the
 * session — Mermaid (3.5 MB) is parsed once. One that fails to start is
 * dropped, so the next diagram tries again rather than inheriting the failure.
 */
export function sandboxRenderer(): Promise<SandboxRenderer> {
  sandbox ??= start().catch((reason: unknown) => {
    sandbox = null
    throw reason
  })
  return sandbox
}
