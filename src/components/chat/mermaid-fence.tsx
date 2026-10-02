import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Segment, Skeleton } from '@/components/base'
import { CopyButton } from '@/components/ui/copy-button'
import { errorMessage } from '@/lib/error-message'
import { renderMermaid, type MermaidImage } from '@/lib/mermaid'
import { useAppTheme } from '@/lib/theme'
import { ShikiCode } from './shiki-code'

type Drawing = { status: 'drawing' } | { status: 'drawn'; image: MermaidImage } | { status: 'failed'; reason: string }

/**
 * A finished ```mermaid fence: the diagram, with its source one switch away.
 *
 * Only a finished one — while the answer streams the fence is drawn as code,
 * since half a diagram is a parse error on every chunk. A diagram that will
 * not draw shows its source with the reason above it, not an empty box: the
 * source is still the answer, and the reason is what to fix.
 */
export function MermaidFence({ code, icon }: { code: string; icon: string | undefined }) {
  const { t } = useTranslation()
  const { resolvedTheme } = useAppTheme()
  const [view, setView] = useState<'diagram' | 'source'>('diagram')
  const [drawing, setDrawing] = useState<Drawing>({ status: 'drawing' })

  useEffect(() => {
    // Drawn in the theme's colours, so not before the theme is known.
    if (resolvedTheme === undefined) return
    // Aborting both drops this render's answer and, if it is still queued
    // behind other diagrams, keeps it from being drawn at all.
    const controller = new AbortController()
    setDrawing({ status: 'drawing' })
    renderMermaid(code, resolvedTheme, controller.signal).then(
      (image) => !controller.signal.aborted && setDrawing({ status: 'drawn', image }),
      (reason: unknown) => !controller.signal.aborted && setDrawing({ status: 'failed', reason: errorMessage(reason) }),
    )
    return () => controller.abort()
  }, [code, resolvedTheme])

  const showSource = view === 'source' || drawing.status === 'failed'

  return (
    <div data-slot="markdown-code-block" className="code-block not-prose my-3 rounded-xl">
      <div data-slot="markdown-code-header" className="code-block__header">
        {icon && <img data-slot="markdown-code-icon" src={icon} alt="" aria-hidden className="size-4 shrink-0" />}
        <span data-slot="markdown-code-language" className="text-caption-1-regular text-text-secondary">
          mermaid
        </span>
        {drawing.status !== 'failed' && (
          <Segment
            aria-label={t('chat.mermaid.view')}
            size="sm"
            selectedKey={view}
            onSelectionChange={(next) => {
              if (next === 'diagram' || next === 'source') setView(next)
            }}
            className="ms-auto"
          >
            <Segment.Item id="diagram">{t('chat.mermaid.diagram')}</Segment.Item>
            <Segment.Item id="source">{t('chat.mermaid.source')}</Segment.Item>
          </Segment>
        )}
        <CopyButton text={code} className={drawing.status === 'failed' ? 'touch-hitbox ms-auto' : 'touch-hitbox'} />
      </div>
      {drawing.status === 'failed' && (
        <p
          data-slot="mermaid-error"
          role="alert"
          className="px-3 pt-2 text-caption-1-regular text-status-danger wrap-break-word"
        >
          {t('chat.mermaid.failed', { error: drawing.reason })}
        </p>
      )}
      {showSource ? (
        <ShikiCode code={code} language="mermaid" />
      ) : drawing.status === 'drawn' ? (
        <div data-slot="mermaid-diagram" className="overflow-x-auto p-3">
          <img
            src={drawing.image.src}
            width={drawing.image.width}
            height={drawing.image.height}
            alt={t('chat.mermaid.alt')}
            className="mx-auto h-auto max-w-full"
          />
        </div>
      ) : (
        <div data-slot="mermaid-drawing" role="status" aria-busy aria-label={t('chat.mermaid.drawing')} className="p-3">
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      )}
    </div>
  )
}
