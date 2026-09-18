import { useTranslation } from 'react-i18next'
import { ArrowRight, FileText } from '@gravity-ui/icons'
import { Link } from '@/components/base'
import { useState } from 'react'
import type { DiffLineKind, FileDiff } from '@/lib/patch-parse'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { highlightInline } from '@/lib/shiki'
import { fileIconUrl } from '@/lib/file-icon'
import { pathExtension } from '@/lib/paths'
import { cx } from '@/utils/cx'
import { PathLabel } from '@/components/ui/path-label'

// ---- Diff rendering for file-editing tools (write_file / edit_file / apply_patch) ----

export { fileNameOf, pathExtension } from '@/lib/paths'

const MAX_DIFF_LINES = 300

/** Highlighted lines keep the tint and give up the tinted foreground: syntax
 *  colours are the point of turning it on, and a green identifier on a green
 *  wash reads worse than either alone. The sign in the gutter stays coloured,
 *  so added and removed are still one glance apart. */
function diffLineClass(kind: DiffLineKind, highlighted: boolean): string {
  switch (kind) {
    case 'add':
      return highlighted
        ? 'bg-status-success-soft text-text-primary/80'
        : 'bg-status-success-soft text-status-success-soft-foreground'
    case 'remove':
      return highlighted
        ? 'bg-status-danger-soft text-text-primary/80'
        : 'bg-status-danger-soft text-status-danger-soft-foreground'
    case 'hunk':
      return 'text-text-secondary'
    default:
      return 'text-text-primary/80'
  }
}

function diffSignClass(kind: DiffLineKind): string | undefined {
  if (kind === 'add') return 'text-status-success-soft-foreground'
  if (kind === 'remove') return 'text-status-danger'
  return undefined
}

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
  if (!src) return <FileText className="w-3.5 h-3.5 shrink-0" />
  // Decorative: the file name it sits beside already names the file.
  return <img data-slot="file-icon" src={src} alt="" aria-hidden className="size-3.5 shrink-0" />
}

/** `+N -M`, coloured. Drawn in the diff's own header, or handed up to a
 *  panel header when the diff is the whole panel. */
export function DiffStats({ diff }: { diff: FileDiff }) {
  const added = diff.lines.filter((l) => l.kind === 'add').length
  const removed = diff.lines.filter((l) => l.kind === 'remove').length
  if (added === 0 && removed === 0) return null
  return (
    <span data-slot="file-diff-stats" className="shrink-0 font-mono tabular-nums">
      {added > 0 && (
        <span data-slot="file-diff-added" className="text-status-success-soft-foreground">
          +{added}
        </span>
      )}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && (
        <span data-slot="file-diff-removed" className="text-status-danger">
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
    <div data-slot="file-diff" data-numbered={numbered || undefined} className="min-w-0 overflow-hidden">
      {header && diff.path !== '' && (
        <div
          data-slot="file-diff-header"
          className="flex items-center gap-2 border-b border-border-button-default/50 bg-background-secondary-default/30 px-3 py-1.5 text-caption-1-regular text-text-secondary"
        >
          <FileIcon path={diff.path} />
          {/* A move used to arrive as one string with an arrow in the middle,
              which read correctly and could not be used as a path. The parser
              keeps the two apart; the header puts them side by side. */}
          {diff.movedFrom && (
            <>
              <PathLabel
                path={diff.movedFrom}
                wrap
                className="text-text-secondary [&_[data-slot=path-name]]:text-text-secondary"
              />
              <ArrowRight aria-hidden className="size-3 shrink-0" />
            </>
          )}
          <PathLabel path={diff.path} wrap />
          {diff.op === 'create' && (
            <span data-slot="file-diff-new-file" className="text-status-success-soft-foreground shrink-0">
              {t('chat.tool.diff.newFile')}
            </span>
          )}
          {diff.op === 'delete' && (
            <span data-slot="file-diff-deleted-file" className="text-status-danger shrink-0">
              {t('chat.tool.diff.deletedFile')}
            </span>
          )}
          {diff.replaceAll && (
            <span data-slot="file-diff-replace-all" className="shrink-0">
              {t('chat.tool.diff.replaceAll')}
            </span>
          )}
          <span data-slot="file-diff-header-end" className="ml-auto">
            <DiffStats diff={diff} />
          </span>
        </div>
      )}
      <div data-slot="file-diff-content" className="max-h-72 overflow-auto">
        <div
          data-slot="file-diff-lines"
          className="w-max min-w-full py-1 font-mono text-caption-1-regular leading-relaxed"
        >
          {shown.map((line, i) => (
            <div
              key={i}
              data-slot="file-diff-line"
              data-kind={line.kind}
              className={cx('flex whitespace-pre', diffLineClass(line.kind, ready))}
            >
              {numbered && (
                // Two columns, old and new, the way a side-by-side gutter reads
                // in a unified view. Digits only: the sign has its own column,
                // and a reader copying the diff should not get numbers with it.
                <span
                  aria-hidden
                  data-slot="file-diff-gutter"
                  className="sticky left-0 flex shrink-0 bg-background-primary-default text-text-secondary/70 select-none tabular-nums"
                >
                  <span data-slot="file-diff-old-no" className="w-10 pr-1 text-right">
                    {line.oldNo ?? ''}
                  </span>
                  <span data-slot="file-diff-new-no" className="w-10 pr-1 text-right">
                    {line.newNo ?? ''}
                  </span>
                </span>
              )}
              <span data-slot="file-diff-sign" className={cx('shrink-0 pl-2', diffSignClass(line.kind))}>
                {diffLinePrefix(line.kind)}
              </span>
              <span data-slot="file-diff-text" className="pr-3">
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
            <div
              data-slot="file-diff-more"
              className="sticky left-0 flex items-center gap-2 px-3 py-1 text-text-secondary"
            >
              {!expanded && (
                <span data-slot="file-diff-hidden-count">{t('chat.tool.diff.moreLines', { count: hidden })}</span>
              )}
              <Link className="text-caption-1-regular" onPress={() => setExpanded((current) => !current)}>
                {t(expanded ? 'chat.tool.diff.showLess' : 'chat.tool.diff.showAll')}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
