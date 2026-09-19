import { useMemo } from 'react'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { highlightInline } from '@/lib/shiki'
import { cx } from '@/utils/cx'

/**
 * Source with a line-number gutter, one row per line.
 *
 * The preview sheet draws its file this way (`FilePreviewLines`), and a
 * `read_file` panel is the same thing at a smaller size: the tool returns the
 * file from its first line, so the gutter starts at one and a reader can
 * quote a line to the model by number. Highlighted per line with
 * `highlightInline`, which returns token spans and no `<pre>`, so each line
 * can sit in its own row beside its number; gated on `ready` because that
 * call is synchronous and answers nothing until the grammar has loaded.
 *
 * `code-block__code` is the old library's class for the scrolling area, reused
 * for its font and line height so a file here matches a fenced block in the answer.
 */
export function NumberedCode({
  code,
  language,
  startLine = 1,
  className,
}: {
  code: string
  language?: string | null
  startLine?: number
  className?: string
}) {
  const lines = useMemo(() => {
    const split = code.split(/\r?\n/)
    if (code.endsWith('\n')) split.pop()
    return split
  }, [code])
  const { language: grammar, ready } = useShikiLanguage(language)
  const highlighted = useMemo(
    () => (ready ? lines.map((line) => (line ? highlightInline(line, grammar) : '')) : null),
    [grammar, lines, ready],
  )
  return (
    <div
      data-slot="numbered-code"
      className={cx(
        'code-block__code w-max min-w-full overflow-visible py-1.5 font-mono text-caption-1-regular leading-5',
        className,
      )}
    >
      {lines.map((line, index) => {
        const number = startLine + index
        return (
          <div
            key={number}
            data-slot="numbered-code-line"
            data-code-line={number}
            className="flex text-text-primary/85"
          >
            <span
              data-slot="numbered-code-line-number"
              aria-hidden
              className="sticky left-0 w-10 shrink-0 bg-background-primary-default pr-2 text-right text-text-secondary/70 select-none tabular-nums"
            >
              {number}
            </span>
            <span data-slot="numbered-code-line-source" className="shiki min-w-0 pr-4 pl-2 whitespace-pre">
              {highlighted && line ? (
                // Shiki escapes the source and returns only token spans here.
                <span data-slot="numbered-code-line-tokens" dangerouslySetInnerHTML={{ __html: highlighted[index] }} />
              ) : (
                line || ' '
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
