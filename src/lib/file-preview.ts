export type RichFilePreview = 'markdown' | 'html'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx'])
const HTML_EXTENSIONS = new Set(['html', 'htm'])

function fileName(path: string): string {
  return path.split(/[/\\]/).pop()?.toLowerCase() ?? ''
}

function fileExtension(path: string): string | undefined {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : undefined
}

/** The source grammar label Shiki should try for this path. */
export function filePreviewLanguage(path: string): string | undefined {
  const name = fileName(path)
  if (name === 'dockerfile') return 'dockerfile'
  return fileExtension(path)
}

/** Rich rendering is deliberately opt-in by extension and only for files. */
export function richFilePreview(path: string): RichFilePreview | null {
  const extension = fileExtension(path)
  if (!extension) return null
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown'
  if (HTML_EXTENSIONS.has(extension)) return 'html'
  return null
}

export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  'img-src data: blob:',
  'media-src data: blob:',
  "style-src 'unsafe-inline'",
  'font-src data:',
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "manifest-src 'none'",
].join('; ')

/**
 * Produce a static HTML document for an opaque, fully sandboxed `srcDoc`.
 *
 * The iframe remains the security boundary. Sanitising obvious active and
 * navigational elements here is defence in depth and also keeps a click in the
 * preview from replacing its own document. Network-capable resources are
 * denied by the first element in `<head>`, before source-authored markup.
 */
export function sandboxHtmlDocument(source: string): string {
  const parsed = new DOMParser().parseFromString(source, 'text/html')

  parsed.querySelectorAll('script, iframe, frame, object, embed, base').forEach((element) => element.remove())
  parsed.querySelectorAll('meta[http-equiv]').forEach((element) => {
    const directive = element.getAttribute('http-equiv')?.trim().toLowerCase()
    if (directive === 'refresh' || directive === 'content-security-policy') element.remove()
  })

  parsed.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name)
    }
    element.removeAttribute('target')
    element.removeAttribute('ping')
  })
  parsed.querySelectorAll('a, area').forEach((element) => {
    element.removeAttribute('href')
    element.removeAttribute('xlink:href')
  })
  parsed.querySelectorAll('form[action]').forEach((element) => element.removeAttribute('action'))
  parsed.querySelectorAll('[formaction]').forEach((element) => element.removeAttribute('formaction'))

  const csp = parsed.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', HTML_PREVIEW_CSP)
  const referrer = parsed.createElement('meta')
  referrer.setAttribute('name', 'referrer')
  referrer.setAttribute('content', 'no-referrer')
  parsed.head.prepend(csp, referrer)

  return `<!doctype html>\n${parsed.documentElement.outerHTML}`
}
