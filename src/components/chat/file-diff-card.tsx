import { FileText } from '@keyline-icons/react/two-tone'
import { ToolDiffStats, ToolDiffView } from '@/components/yuerchu-ui/components/tool-views/tool-views'
import type { FileDiff } from '@/lib/patch-parse'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { highlightInline } from '@/lib/shiki'
import { fileIconUrl } from '@/lib/file-icon'
import { pathExtension } from '@/lib/paths'

// ---- Diff rendering for file-editing tools (write_file / edit_file / apply_patch) ----

export { fileNameOf, pathExtension } from '@/lib/paths'

export function FileIcon({ path }: { path: string }) {
  const src = fileIconUrl(path)
  if (!src) return <FileText className="ui-tool-views__icon-sm" aria-hidden />
  // Decorative: the file name it sits beside already names the file.
  return <img data-slot="file-icon" src={src} alt="" aria-hidden className="ui-tool-views__icon-sm" />
}

/** `+N -M`, coloured. Drawn in the diff's own header, or handed up to a
 *  panel header when the diff is the whole panel. */
export function DiffStats({ diff }: { diff: FileDiff }) {
  const added = diff.lines.filter((l) => l.kind === 'add').length
  const removed = diff.lines.filter((l) => l.kind === 'remove').length
  return <ToolDiffStats added={added} removed={removed} />
}

/**
 * One file's diff, backed by `@yuerchu/ui`'s `ToolDiffView` with Meridian's
 * Shiki inline highlighter and file icon set plugged in.
 */
export function FileDiffCard({ diff, header = true }: { diff: FileDiff; header?: boolean }) {
  const { language, ready } = useShikiLanguage(pathExtension(diff.path))

  return (
    <ToolDiffView
      path={diff.path}
      lines={diff.lines}
      op={diff.op}
      movedFrom={diff.movedFrom}
      replaceAll={diff.replaceAll}
      header={header}
      highlighted={ready}
      renderIcon={(p) => <FileIcon path={p} />}
      renderLine={(text, line) =>
        ready && line.kind !== 'hunk' && text ? (
          // Shiki escapes what it emits, and the sign beside it is ours.
          <span
            data-slot="file-diff-highlighted"
            dangerouslySetInnerHTML={{ __html: highlightInline(text, language) }}
          />
        ) : (
          text || ' '
        )
      }
    />
  )
}
