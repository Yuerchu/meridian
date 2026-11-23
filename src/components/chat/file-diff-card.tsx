import './file-diff-card.css'
import { useTranslation } from 'react-i18next'
import { ArrowRight, FileText } from '@keyline-icons/react/two-tone'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { useState } from 'react'
import type { DiffLineKind, FileDiff } from '@/lib/patch-parse'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { highlightInline } from '@/lib/shiki'
import { fileIconUrl } from '@/lib/file-icon'
import { pathExtension } from '@/lib/paths'
import { PathLabel } from '@/components/ui/path-label'

// ---- Diff rendering for file-editing tools (write_file / edit_file / apply_patch) ----

export { fileNameOf, pathExtension } from '@/lib/paths'

const MAX_DIFF_LINES = 300

function diffLinePrefix(kind: DiffLineKind): string {
  switch (kind) {
    case 'add':
      return '+ '
    case 'remove':
      return '- '
    case 'hunk':
      return ''
    default:
      return '  '
  }
}

export function FileIcon({ path }: { path: string }) {
  const src = fileIconUrl(path)
  if (!src) return <FileText className="m-file-diff__icon" aria-hidden />
  // Decorative: the file name it sits beside already names the file.
  return <img data-slot="file-icon" src={src} alt="" aria-hidden className="m-file-diff__icon" />
}

/** `+N -M`, coloured. Drawn in the diff's own header, or handed up to a
 *  panel header when the diff is the whole panel. */
export function DiffStats({ diff }: { diff: FileDiff }) {
  const added = diff.lines.filter((l) => l.kind === 'add').length
  const removed = diff.lines.filter((l) => l.kind === 'remove').length
  if (added === 0 && removed === 0) return null
  return (
    <span data-slot="file-diff-stats" className="m-file-diff__stats">
      {added > 0 && (
        <span data-slot="file-diff-added" className="m-file-diff__added">
          +{added}
        </span>
      )}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && (
        <span data-slot="file-diff-removed" className="m-file-diff__removed">
          -{removed}
        </span>
      )}
    </span>
  )
}

/**
 * One file's diff.
 *
 * Flat — no box of its own. It sits in a panel body that already is one, and
 * a rounded card inside a rounded card is the double edge the Widget shell
 * was brought in to remove. `header` is off when the panel's header already
 * names the file, which is every single-file write and edit; a patch that
 * touches several files keeps a header per file.
 *
 * **Line numbers are drawn only when the lines carry them.** Nothing here
 * counts: `numberDiffLines` is called by whoever knows where the change
 * starts, and a diff that reaches this card unnumbered — a Codex-style patch,
 * an edit whose file could not be read — is drawn without a gutter rather
 * than with a gutter counted from a guess.
 */
export function FileDiffCard({ diff, header = true }: { diff: FileDiff; header?: boolean }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? diff.lines : diff.lines.slice(0, MAX_DIFF_LINES)
  const hidden = diff.lines.length - shown.length
  const numbered = diff.lines.some((line) => line.oldNo !== undefined || line.newNo !== undefined)
  // One grammar for the whole card, then every line colours from it. A diff is
  // not a program — its lines come from two versions with the context between
  // them missing — so there is nothing to parse as a whole anyway: a template
  // literal spanning several lines loses its colour after the first, which is
  // the price of colouring the other 99%.
  const { language, ready } = useShikiLanguage(pathExtension(diff.path))

  return (
    <div data-slot="file-diff" data-numbered={numbered || undefined} className="m-file-diff">
      {header && diff.path !== '' && (
        <div data-slot="file-diff-header" className="m-file-diff__header">
          <FileIcon path={diff.path} />
          {/* A move used to arrive as one string with an arrow in the middle,
              which read correctly and could not be used as a path. The parser
              keeps the two apart; the header puts them side by side. */}
          {diff.movedFrom && (
            <>
              <PathLabel path={diff.movedFrom} wrap className="m-file-diff__moved-from" />
              <ArrowRight aria-hidden className="m-file-diff__move-arrow" />
            </>
          )}
          <PathLabel path={diff.path} wrap />
          {diff.op === 'create' && (
            <span data-slot="file-diff-new-file" className="m-file-diff__new-file">
              {t('chat.tool.diff.newFile')}
            </span>
          )}
          {diff.op === 'delete' && (
            <span data-slot="file-diff-deleted-file" className="m-file-diff__deleted-file">
              {t('chat.tool.diff.deletedFile')}
            </span>
          )}
          {diff.replaceAll && (
            <span data-slot="file-diff-replace-all" className="m-file-diff__replace-all">
              {t('chat.tool.diff.replaceAll')}
            </span>
          )}
          <span data-slot="file-diff-header-end" className="m-file-diff__header-end">
            <DiffStats diff={diff} />
          </span>
        </div>
      )}
      <div data-slot="file-diff-content" className="m-file-diff__content">
        <div data-slot="file-diff-lines" className="m-file-diff__lines">
          {shown.map((line, i) => (
            <div
              key={i}
              data-slot="file-diff-line"
              data-kind={line.kind}
              data-highlighted={ready || undefined}
              className="m-file-diff__line"
            >
              {numbered && (
                // Two columns, old and new, the way a side-by-side gutter reads
                // in a unified view. Digits only: the sign has its own column,
                // and a reader copying the diff should not get numbers with it.
                <span aria-hidden data-slot="file-diff-gutter" className="m-file-diff__gutter">
                  <span data-slot="file-diff-old-no" className="m-file-diff__old-no">
                    {line.oldNo ?? ''}
                  </span>
                  <span data-slot="file-diff-new-no" className="m-file-diff__new-no">
                    {line.newNo ?? ''}
                  </span>
                </span>
              )}
              <span data-slot="file-diff-sign" className="m-file-diff__sign">
                {diffLinePrefix(line.kind)}
              </span>
              <span data-slot="file-diff-text" className="m-file-diff__text">
                {ready && line.kind !== 'hunk' && line.text ? (
                  // Shiki escapes what it emits, and the sign beside it is ours.
                  <span
                    data-slot="file-diff-highlighted"
                    dangerouslySetInnerHTML={{ __html: highlightInline(line.text, language) }}
                  />
                ) : (
                  line.text || ' '
                )}
              </span>
            </div>
          ))}
          {diff.lines.length > MAX_DIFF_LINES && (
            <div data-slot="file-diff-more" className="m-file-diff__more">
              {!expanded && (
                <span data-slot="file-diff-hidden-count">{t('chat.tool.diff.moreLines', { count: hidden })}</span>
              )}
              <Button variant="ghost" size="sm" onPress={() => setExpanded((current) => !current)}>
                {t(expanded ? 'chat.tool.diff.showLess' : 'chat.tool.diff.showAll')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
