import { useMemo } from 'react'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { highlight } from '@/lib/shiki'
import { cx } from '@/utils/cx'

const highlightCache = new Map<string, string>()
const MAX_CACHE_ENTRIES = 64

function cachedHighlight(code: string, language: string): string {
  const key = `${language}\u0000${code}`
  const cached = highlightCache.get(key)
  if (cached !== undefined) return cached
  const html = highlight(code, language)
  if (highlightCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = highlightCache.keys().next().value
    if (oldest !== undefined) highlightCache.delete(oldest)
  }
  highlightCache.set(key, html)
  return html
}

/**
 * The highlighted body of a code block.
 *
 * Stands in for the old library's `CodeBlock.Code`, which imports Shiki's full
 * entry point — every grammar it ships as a chunk apiece, plus the oniguruma
 * WASM. This one goes through `lib/shiki`, where the grammar list is ours.
 *
 * It keeps the old `code-block__code` class: that is where the font, the
 * horizontal scroll and — the part worth having — the rule that picks
 * `--shiki-light` or `--shiki-dark` per token all live, so a theme switch stays
 * free and needs no re-highlight.
 *
 * Before the grammar arrives the same text renders unhighlighted, in the same
 * font at the same line height, so the block does not change height when colour
 * appears. That matters here: the transcript may be following the live edge
 * while this resolves.
 */
export function ShikiCode({
  code,
  language,
  className,
  defer,
}: {
  code: string
  language?: string | null
  className?: string
  /** Streamed blocks stay plain until their content settles. */
  defer?: boolean
}) {
  const { language: lang, ready } = useShikiLanguage(language)
  const html = useMemo(() => (ready && !defer ? cachedHighlight(code, lang) : ''), [code, defer, lang, ready])

  if (!ready || defer) {
    return (
      <div data-slot="shiki-code-plain" className={cx('code-block__code', className)}>
        <pre data-slot="shiki-code-pre">
          <code data-slot="shiki-code-source">{code}</code>
        </pre>
      </div>
    )
  }

  return (
    <div
      data-slot="shiki-code"
      className={cx('code-block__code', className)}
      // Shiki escapes the code it is given; what comes back is its own markup
      // around that escaped text.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
