import { HTML_PREVIEW_CSP, filePreviewLanguage, richFilePreview, sandboxHtmlDocument } from './file-preview'

describe('file preview classification', () => {
  it('recognises source grammars and only the supported rich formats', () => {
    expect(filePreviewLanguage('src/example.test.ts')).toBe('ts')
    expect(filePreviewLanguage('Dockerfile')).toBe('dockerfile')
    expect(richFilePreview('README.md')).toBe('markdown')
    expect(richFilePreview('public/index.HTML')).toBe('html')
    expect(richFilePreview('src/example.ts')).toBeNull()
  })
})

describe('sandboxHtmlDocument', () => {
  it('puts the restrictive policy first and removes active or navigational markup', () => {
    const source = `<!doctype html>
      <html><head>
        <meta http-equiv="refresh" content="0;url=https://example.com">
        <base href="https://example.com">
      </head><body onload="alert(1)">
        <script>alert(1)</script>
        <iframe src="https://example.com"></iframe>
        <a href="https://example.com" xlink:href="https://example.com" target="_top" onclick="alert(1)">go</a>
        <form action="https://example.com"><button formaction="https://example.com">send</button></form>
      </body></html>`

    const result = sandboxHtmlDocument(source)
    const parsed = new DOMParser().parseFromString(result, 'text/html')
    const policy = parsed.head.firstElementChild

    expect(policy?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(policy?.getAttribute('content')).toBe(HTML_PREVIEW_CSP)
    expect(parsed.querySelector('script, iframe, frame, object, embed, base')).toBeNull()
    expect(parsed.querySelector('meta[http-equiv="refresh"]')).toBeNull()
    expect(parsed.body.hasAttribute('onload')).toBe(false)
    expect(parsed.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(parsed.querySelector('a')?.hasAttribute('xlink:href')).toBe(false)
    expect(parsed.querySelector('a')?.hasAttribute('target')).toBe(false)
    expect(parsed.querySelector('a')?.hasAttribute('onclick')).toBe(false)
    expect(parsed.querySelector('form')?.hasAttribute('action')).toBe(false)
    expect(parsed.querySelector('button')?.hasAttribute('formaction')).toBe(false)
  })
})
