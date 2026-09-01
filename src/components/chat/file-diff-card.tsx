import { useTranslation } from 'react-i18next'
import { FileText } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { useState } from 'react'
import type { DiffLineKind, FileDiff } from '@/lib/patch-parse'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { highlightInline } from '@/lib/shiki'
import { fileIconUrl } from '@/lib/file-icon'
import { cn } from '@/lib/utils'
import { Hint } from '@/components/ui/hint'

// ---- Diff rendering for file-editing tools (write_file / edit_file / apply_patch) ----

const MAX_DIFF_LINES = 300

/** Highlighted lines keep the tint and give up the tinted foreground: syntax
 *  colours are the point of turning it on, and a green identifier on a green
 *  wash reads worse than either alone. The sign in the gutter stays coloured,
 *  so added and removed are still one glance apart. */
function diffLineClass(kind: DiffLineKind, highlighted: boolean): string {
  switch (kind) {
    case 'add':
      return highlighted ? 'bg-success/10 text-foreground/80' : 'bg-success/10 text-success-soft-foreground'
    case 'remove':
      return highlighted ? 'bg-danger/10 text-foreground/80' : 'bg-danger/10 text-danger'
    case 'hunk':
      return 'text-muted'
    default:
      return 'text-foreground/80'
  }
}

function diffSignClass(kind: DiffLineKind): string | undefined {
  if (kind === 'add') return 'text-success-soft-foreground'
  if (kind === 'remove') return 'text-danger'
  return undefined
}

/** The extension a path ends in, or nothing when it has none. */
export function pathExtension(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  if (!ext || ext === path.toLowerCase()) return undefined
  return ext
}

/**
 * The file's own name, without the path leading to it.
 *
 * Deliberately not the last two segments, which was tried: the card's argument
 * summary already prints the full path above these headers, so qualifying them
 * put the same string on screen twice — and the review note that asked for it
 * ("the path is only in a `title`, which a touch screen cannot reach") was
 * reading this header on its own rather than the card around it. The `title`
 * stays for the move case, where it carries something the summary does not.
 */
export function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
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
  return <img src={src} alt="" aria-hidden className="size-3.5 shrink-0" />
}

export function FileDiffCard({ diff }: { diff: FileDiff }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const added = diff.lines.filter((l) => l.kind === 'add').length
  const removed = diff.lines.filter((l) => l.kind === 'remove').length
  // The file plus the folder holding it, not the file alone. The full path was
  // in a `title`, which is a hover — and a touch screen has none, so a card
  // saying `index.ts` was one of several indistinguishable cards. One level of
  // parent is what separates them in practice and still fits a narrow card;
  // the `title` below keeps the whole path for a pointer.
  const fileName = fileNameOf(diff.path)
  const shown = expanded ? diff.lines : diff.lines.slice(0, MAX_DIFF_LINES)
  const hidden = diff.lines.length - shown.length
  // One grammar for the whole card, then every line colours from it. A diff is
  // not a program — its lines come from two versions with the context between
  // them missing — so there is nothing to parse as a whole anyway: a template
  // literal spanning several lines loses its colour after the first, which is
  // the price of colouring the other 99%.
  const { language, ready } = useShikiLanguage(pathExtension(diff.path))

  return (
    <div data-slot="file-diff" className="rounded-lg bg-default/40 overflow-hidden">
      {diff.path !== '' && (
        <div
          data-slot="file-diff-header"
          className="flex items-center gap-2 px-3 py-1 bg-default/30 text-xs text-muted border-b border-border/50"
        >
          <FileIcon path={diff.path} />
          {/* A move used to arrive as one string with an arrow in the middle,
              which read correctly and could not be used as a path. The parser
              keeps the two apart now; the tooltip puts them back together. */}
          <Hint className="font-mono truncate" label={diff.movedFrom ? `${diff.movedFrom} → ${diff.path}` : diff.path}>
            {fileName}
          </Hint>
          {diff.op === 'create' && (
            <span className="text-success-soft-foreground shrink-0">{t('chat.tool.diff.newFile')}</span>
          )}
          {diff.op === 'delete' && <span className="text-danger shrink-0">{t('chat.tool.diff.deletedFile')}</span>}
          {diff.replaceAll && <span className="shrink-0">{t('chat.tool.diff.replaceAll')}</span>}
          {(added > 0 || removed > 0) && (
            <span data-slot="file-diff-stats" className="ml-auto shrink-0 font-mono">
              {added > 0 && <span className="text-success-soft-foreground">+{added}</span>}
              {added > 0 && removed > 0 && ' '}
              {removed > 0 && <span className="text-danger">-{removed}</span>}
            </span>
          )}
        </div>
      )}
      <div data-slot="file-diff-content" className="max-h-60 overflow-auto">
        <div className="py-1 font-mono text-xs leading-relaxed w-max min-w-full">
          {shown.map((line, i) => (
            <div
              key={i}
              data-slot="file-diff-line"
              data-kind={line.kind}
              className={cn('px-3 whitespace-pre', diffLineClass(line.kind, ready))}
            >
              <span className={diffSignClass(line.kind)}>{diffLinePrefix(line.kind)}</span>
              {ready && line.kind !== 'hunk' && line.text ? (
                // Shiki escapes what it emits, and the sign beside it is ours.
                <span dangerouslySetInnerHTML={{ __html: highlightInline(line.text, language) }} />
              ) : (
                line.text || ' '
              )}
            </div>
          ))}
          {diff.lines.length > MAX_DIFF_LINES && (
            <div className="sticky left-0 flex items-center gap-2 px-3 py-1 text-muted">
              {!expanded && <span>{t('chat.tool.diff.moreLines', { count: hidden })}</span>}
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-1 py-0.5 text-xs"
                onPress={() => setExpanded((current) => !current)}
              >
                {t(expanded ? 'chat.tool.diff.showLess' : 'chat.tool.diff.showAll')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
