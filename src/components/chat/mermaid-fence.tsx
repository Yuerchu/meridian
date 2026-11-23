import './mermaid-fence.css'
import './view-switch.css'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
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
    <div data-slot="markdown-code-block" className="code-block m-mermaid__block">
      <div data-slot="markdown-code-header" className="code-block__header">
        {icon && <img data-slot="markdown-code-icon" src={icon} alt="" aria-hidden className="m-mermaid__icon" />}
        <span data-slot="markdown-code-language" className="m-mermaid__language">
          mermaid
        </span>
        {drawing.status !== 'failed' && (
          <div className="m-mermaid__view">
            <SegmentedControl
              aria-label={t('chat.mermaid.view')}
              size="sm"
              selectedKey={view}
              onSelectionChange={(next) => {
                if (next === 'diagram' || next === 'source') setView(next)
              }}
            >
              <Segment id="diagram">{t('chat.mermaid.diagram')}</Segment>
              <Segment id="source">{t('chat.mermaid.source')}</Segment>
            </SegmentedControl>
          </div>
        )}
        <span className="m-mermaid__copy" data-auto={drawing.status === 'failed' || undefined}>
          <CopyButton text={code} />
        </span>
      </div>
      {drawing.status === 'failed' && (
        <p data-slot="mermaid-error" role="alert" className="m-mermaid__error">
          {t('chat.mermaid.failed', { error: drawing.reason })}
        </p>
      )}
      {showSource ? (
        <ShikiCode code={code} language="mermaid" />
      ) : drawing.status === 'drawn' ? (
        <div data-slot="mermaid-diagram" className="m-mermaid__diagram">
          <img
            src={drawing.image.src}
            width={drawing.image.width}
            height={drawing.image.height}
            alt={t('chat.mermaid.alt')}
            className="m-mermaid__image"
          />
        </div>
      ) : (
        <div
          data-slot="mermaid-drawing"
          role="status"
          aria-busy
          aria-label={t('chat.mermaid.drawing')}
          className="m-mermaid__drawing"
        >
          <Skeleton shape="rect" width="100%" height="8rem" />
        </div>
      )}
    </div>
  )
}
