import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import { PLAIN, ensureLanguage, highlight, isReady, resolveLanguage } from '@/lib/shiki'

/**
 * The highlighted body of a code block.
 *
 * Stands in for Pro's `CodeBlock.Code`, which imports Shiki's full entry point
 * — every grammar it ships, a chunk apiece, plus the oniguruma WASM. This one
 * goes through `lib/shiki`, where the grammar list is ours.
 *
 * It keeps Pro's `code-block__code` class: that is where the font, the
 * horizontal scroll and — the part worth having — the rule that picks
 * `--shiki-light` or `--shiki-dark` per token all live, so a theme switch stays
 * free and needs no re-highlight.
 *
 * Before the grammar arrives the same text renders unhighlighted, in the same
 * font at the same line height, so the block does not change height when colour
 * appears. That matters here: the transcript may be following the live edge
 * while this resolves.
 */
export function ShikiCode({ code, language, className }: { code: string; language?: string | null; className?: string }) {
  const lang = resolveLanguage(language)
  const [ready, setReady] = useState(() => isReady(lang))

  useEffect(() => {
    if (isReady(lang)) {
      setReady(true)
      return
    }
    setReady(false)
    let alive = true
    void ensureLanguage(lang).then(() => {
      if (alive) setReady(isReady(lang))
    })
    return () => { alive = false }
  }, [lang])

  if (!ready || lang === PLAIN) {
    return (
      <div className={cn('code-block__code', className)}>
        <pre><code>{code}</code></pre>
      </div>
    )
  }

  return (
    <div
      className={cn('code-block__code', className)}
      // Shiki escapes the code it is given; what comes back is its own markup
      // around that escaped text.
      dangerouslySetInnerHTML={{ __html: highlight(code, lang) }}
    />
  )
}
