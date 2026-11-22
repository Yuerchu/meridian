import './context-meter.css'
import { useTranslation } from 'react-i18next'
import { formatDefinitionTokens } from './format'

export interface ContextMeterSegment {
  id: string
  name: string
  tokens: number
}

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
    <div data-slot="mcp-context-meter" className="m-context-meter">
      <p data-slot="mcp-context-meter-line" className="m-context-meter__line">
        <span className="m-context-meter__number">{toolsLabel}</span>
        <span aria-hidden className="m-context-meter__separator">
          ·
        </span>
        <span className="m-context-meter__number">{tokensLabel}</span>
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
        className="m-context-meter__track"
      >
        {segments.map((segment, index) => (
          <span
            key={segment.id}
            data-slot="mcp-context-meter-segment"
            data-series={index + 1}
            data-hot={hotId === segment.id || undefined}
            data-dimmed={hotId !== null && hotId !== segment.id ? true : undefined}
            title={`${segment.name} · ${formatDefinitionTokens(segment.tokens)}`}
            className="m-context-meter__segment"
            style={{ flexGrow: segment.tokens, flexBasis: 0 }}
          />
        ))}
      </div>
    </div>
  )
}
