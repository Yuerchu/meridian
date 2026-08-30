import { render, screen } from '@testing-library/react'

import { ShikiCode } from './shiki-code'

const shiki = vi.hoisted(() => ({
  highlight: vi.fn(() => '<pre><code><span>highlighted</span></code></pre>'),
}))

vi.mock('@/hooks/use-shiki-language', () => ({
  useShikiLanguage: () => ({ language: 'typescript', ready: true }),
}))
vi.mock('@/lib/shiki', () => ({ highlight: shiki.highlight }))

describe('ShikiCode streaming work', () => {
  beforeEach(() => shiki.highlight.mockClear())

  it('defers highlighting while streaming and caches the settled result across mounts', () => {
    const code = 'const streamingCacheFixture = 1'
    const first = render(<ShikiCode code={code} language="ts" defer />)

    expect(screen.getByText(code)).toBeVisible()
    expect(shiki.highlight).not.toHaveBeenCalled()

    first.rerender(<ShikiCode code={code} language="ts" defer={false} />)
    expect(screen.getByText('highlighted')).toBeVisible()
    expect(shiki.highlight).toHaveBeenCalledTimes(1)
    first.unmount()

    render(<ShikiCode code={code} language="ts" />)
    expect(screen.getByText('highlighted')).toBeVisible()
    expect(shiki.highlight).toHaveBeenCalledTimes(1)
  })
})
