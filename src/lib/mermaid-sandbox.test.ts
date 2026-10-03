import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseAnswer, sandboxDocument, sandboxRenderer } from './mermaid-sandbox'

const sha256 = (text: string) => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`

function parsed(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')
  const directives = Object.fromEntries(
    (meta?.getAttribute('content') ?? '')
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...sources]) => [name, sources]),
  )
  return { directives, scripts: [...doc.querySelectorAll('script')].map((s) => s.textContent ?? '') }
}

/**
 * The sandbox's CSP is the wall between a hostile diagram and everything
 * else. Measured in Chromium with this policy: an image node and a `url()` in
 * an `%%{init}%%` theme failed with `csp`, and an injected `<img onerror>` did
 * not run.
 */
describe('the sandbox document', () => {
  it('admits its two scripts by hash and nothing else, and fetches nothing', async () => {
    const { directives, scripts } = parsed(await sandboxDocument('var library = 1', 'var bridge = 2'))

    expect(scripts).toEqual(['var library = 1', 'var bridge = 2'])
    expect(directives['default-src']).toEqual(["'none'"])
    expect(directives['script-src']).toEqual(scripts.map((s) => `'${sha256(s)}'`))
    expect(directives['img-src']).toEqual(['data:'])
    expect(directives['style-src']).toEqual(["'unsafe-inline'"])
    expect(Object.keys(directives).sort()).toEqual(['default-src', 'img-src', 'script-src', 'style-src'])
  })

  // A `</script>` inside the library would end the element early and leave
  // the rest as markup; the hash has to be of the text as it sits.
  it('keeps a script that mentions </script> whole, and hashes it as written', async () => {
    const { directives, scripts } = parsed(await sandboxDocument('var s = "</script><b>x</b>"', 'void 0'))

    expect(scripts).toHaveLength(2)
    expect(scripts[0]).toBe('var s = "<\\/script><b>x</b>"')
    expect(directives['script-src'][0]).toBe(`'${sha256(scripts[0])}'`)
  })
})

describe('parseAnswer', () => {
  it('takes the two shapes the bridge sends', () => {
    expect(parseAnswer({ id: 1, svg: '<svg/>' })).toEqual({ id: 1, svg: '<svg/>' })
    expect(parseAnswer({ id: 2, error: 'Parse error' })).toEqual({ id: 2, error: 'Parse error' })
  })

  it('ignores anything else the frame might send', () => {
    for (const data of [
      null,
      'svg',
      [1],
      { id: '1', svg: '<svg/>' },
      { id: 1, svg: 1 },
      { id: 1, svg: '<svg/>', extra: true },
      { id: 1, svg: '<svg/>', error: 'both' },
      { ready: true },
    ]) {
      expect(parseAnswer(data)).toBeNull()
    }
  })
})

describe('sandboxRenderer', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  // jsdom runs no scripts in the frame, so it never says it is ready: which
  // is the failure case, and the frame it made is still there to inspect.
  it('makes an opaque, off-screen frame, and gives it up if it never starts', async () => {
    vi.useFakeTimers()
    const started = sandboxRenderer()
    const failed = expect(started).rejects.toThrow('The diagram sandbox did not start')

    await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull())
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    expect(frame.srcdoc).toContain('Content-Security-Policy')

    await vi.advanceTimersByTimeAsync(30_000)
    await failed
    expect(document.querySelector('iframe')).toBeNull()
  })
})
