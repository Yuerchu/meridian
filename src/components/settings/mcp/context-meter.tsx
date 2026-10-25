import { useTranslation } from 'react-i18next'

import { cx } from '@/utils/cx'

import { formatDefinitionTokens } from './format'

export interface ContextMeterSegment {
  id: string
  name: string
  tokens: number
}

const SEGMENT_FILL = [
  'bg-accent-500',
  'bg-accent-500/80',
  'bg-accent-500/60',
  'bg-accent-500/45',
  'bg-accent-500/30',
] as const

/**
 * How much of the prompt prefix the enabled MCP tool definitions take, as a
 * line and a bar with a segment per server. There is no invented budget: the
 * bar is the enabled total, split by server.
 */
export function ContextMeter({
  segments,
  toolCount,
  hotId,
}: {
  segments: ContextMeterSegment[]
  toolCount: number
  hotId: string | null
}) {
  const { t } = useTranslation()
  const total = segments.reduce((sum, segment) => sum + segment.tokens, 0)
  if (total === 0 || toolCount === 0) return null

  const tokensLabel = formatDefinitionTokens(total)
  const toolsLabel = t('settings.mcp.toolCount', { count: toolCount })
  const valuetext = t('settings.mcp.meterValueText', { tools: toolsLabel, tokens: tokensLabel })

  return (
    <div data-slot="mcp-context-meter" className="flex flex-col gap-2 px-3 py-2.5 pr-2.5">
      <p data-slot="mcp-context-meter-line" className="text-body-2-regular text-text-secondary">
        <span className="tabular-nums text-text-primary">{toolsLabel}</span>
        <span aria-hidden className="mx-1.5">
          ·
        </span>
        <span className="tabular-nums text-text-primary">{tokensLabel}</span>
        <span> {t('settings.mcp.tokensEstimate')}</span>
      </p>
      <div
        data-slot="mcp-context-meter-track"
        role="meter"
        aria-label={t('settings.mcp.meterLabel')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={total}
        aria-valuetext={valuetext}
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-background-tertiary-default"
      >
        {segments.map((segment, index) => (
          <span
            key={segment.id}
            data-slot="mcp-context-meter-segment"
            data-hot={hotId === segment.id || undefined}
            title={`${segment.name} · ${formatDefinitionTokens(segment.tokens)}`}
            className={cx(
              'h-full min-w-0 transition-opacity duration-150',
              SEGMENT_FILL[index % SEGMENT_FILL.length],
              hotId && hotId !== segment.id ? 'opacity-40' : 'opacity-100',
            )}
            style={{ flexGrow: segment.tokens, flexBasis: 0 }}
          />
        ))}
      </div>
    </div>
  )
}
