import './context-gauge.css'
import { DialogTrigger, Dialog as PopoverDialog, Button as PopoverButton } from 'react-aria-components'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from '@keyline-icons/react/two-tone'

import { Link } from '@/components/base'
import { ProgressCircle } from '@/components/yuerchu-ui/components/progress-circle/progress-circle'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { ErrorAlert } from '@/components/ui/error-alert'

import type { AcpUsage } from '@/hooks/use-acp-config'
import type { ContextInfo } from '@/hooks/use-context-info'

interface ContextGaugeProps {
  /** What this app knows about the window; nothing is drawn while loading. */
  context?: ContextInfo
  /** A hosted session: the numbers above are not about it. */
  hosted?: boolean
  /** What the *agent* last said about its own window. Only for a hosted
   *  session, and absent until it has said anything this session. */
  agentUsage?: AcpUsage | null
  /** The model the agent reports, when it has. */
  agentModel?: string | null
  compacting?: boolean
  streaming?: boolean
  onCompact?: () => void
  /** The percentage beside the ring, as the composer's status tab draws it. */
  showPercent?: boolean
}

/**
 * Whether the gauge draws anything for these inputs — a reading, or the
 * failure that stands in for one. The status tab asks, so that a conversation
 * with nothing measured yet has no tab rather than an empty one.
 */
export function hasContextReading({
  context,
  hosted,
  agentUsage,
}: Pick<ContextGaugeProps, 'context' | 'hosted' | 'agentUsage'>): boolean {
  if (!hosted && context?.status === 'unavailable') return true
  return readingOf({ context, hosted, agentUsage }) !== null
}

function readingOf({ context, hosted, agentUsage }: Pick<ContextGaugeProps, 'context' | 'hosted' | 'agentUsage'>) {
  const reading = context?.status === 'ready' ? context.reading : undefined
  const used = hosted ? agentUsage?.used : reading?.estimatedTokens
  const limit = hosted ? agentUsage?.size : reading?.contextLimit
  if (used === undefined || !limit) return null
  if (!hosted && (!reading || reading.messageCount === 0)) return null
  return { reading, used, limit }
}

/**
 * How full the context window is, as a ring with the figures behind it.
 *
 * **A hosted session is measured by the agent or not at all.** Everything this
 * app can compute — the estimate, the limit, the auto-compact countdown, the
 * manual compact button — describes a request it never makes: `session/prompt`
 * carries the newest message and nothing else, so our transcript is not the
 * agent's context, our model is not the one answering, and our summariser would
 * rewrite a history the agent never reads. Shown anyway, that panel was four
 * confident numbers about the wrong conversation.
 *
 * What the agent does report is `used`/`size` on `usage_update`, which is
 * exactly this question asked of the right window. Before it has said anything
 * there is no ring, because the honest reading is that nobody has measured yet.
 */
export function ContextGauge({
  context,
  hosted,
  agentUsage,
  agentModel,
  compacting,
  streaming,
  onCompact,
  showPercent,
}: ContextGaugeProps) {
  const { t } = useTranslation()

  // The reading failed. Drawn in the dial's place rather than leaving the last
  // numbers up — after a model switch those describe a window this
  // conversation no longer goes into — or, before the first reading, nothing at
  // all, which is what a conversation with nothing in it looks like. There is
  // no "unknown window" reading to draw instead: the backend refuses to size a
  // turn without one, so a failed read is the only way the window goes
  // unknown. The reason is one press away, with the retry beside it.
  if (!hosted && context?.status === 'unavailable') {
    const label = t('chat.context.unavailable')
    return (
      <DialogTrigger>
        <TooltipTrigger>
          <PopoverButton aria-label={label} data-slot="context-gauge-error" className="m-context-gauge__error-trigger">
            <TriangleAlert aria-hidden className="m-context-gauge__error-icon" />
          </PopoverButton>
          <Tooltip>{label}</Tooltip>
        </TooltipTrigger>
        <Popover offset={8} placement="top" className="m-context-gauge__panel-1">
          <PopoverDialog aria-label={t('chat.context.title')}>
            <div className="m-context-gauge__panel-1-body">
              <ErrorAlert title={label} message={context.reason} onRetry={context.retry} />
            </div>
          </PopoverDialog>
        </Popover>
      </DialogTrigger>
    )
  }

  const measured = readingOf({ context, hosted, agentUsage })
  if (!measured) return null
  const { reading, used, limit } = measured

  const ratio = used / limit
  const figures = t('chat.context.tokens', {
    used: used.toLocaleString(),
    limit: limit.toLocaleString(),
  })

  // A delegated run has its own model and its own limit, so the same percentage
  // means a different number of tokens — and the conversation it was started
  // from is one tap away, which is exactly when that gets confusing. Only those
  // two kinds are sub-agents; a hosted session is a peer, and reading any
  // non-empty `agentKind` as "sub-agent" labelled it `子 Agent（Agent）`.
  const subAgent = reading?.agentKind === 'agent' || reading?.agentKind === 'explore'
  const whose = hosted
    ? (agentModel ?? t('chat.context.hostedAgent'))
    : subAgent
      ? t('chat.context.forSubAgent', {
          kind: t(`chat.subAgent.${reading?.agentKind === 'explore' ? 'explore' : 'agent'}`),
          model: reading?.model,
        })
      : reading?.model

  return (
    // A popover rather than a tooltip. This panel has a button in it, and a
    // tooltip is not a place a button can live: it is announced as a
    // description, it closes when the pointer leaves on the way to what it
    // contains, and nothing in it is reachable from the keyboard.
    <DialogTrigger>
      {/* The compact dial keeps an expanded touch target without making the toolbar taller. */}
      <TooltipTrigger>
        <PopoverButton aria-label={figures} data-percent={showPercent || null} className="m-context-gauge__trigger">
          <span aria-hidden="true">
            <ProgressCircle aria-label={figures} value={used} maxValue={limit} isIndeterminate={compacting} size="sm" />
          </span>
          {showPercent && (
            <span data-slot="context-gauge-percent" className="m-context-gauge__percent">
              {Math.round(ratio * 100)}%
            </span>
          )}
        </PopoverButton>
        <Tooltip>{figures}</Tooltip>
      </TooltipTrigger>
      <Popover offset={8} placement="top" className="m-context-gauge__panel-2">
        <PopoverDialog aria-label={t('chat.context.title')}>
          <div className="m-context-gauge__panel-2-body m-context-gauge__details">
            {compacting && !hosted ? (
              <span data-slot="context-gauge-compacting">{t('chat.compact.inProgress')}</span>
            ) : (
              <>
                <span data-slot="context-gauge-model" className="m-context-gauge__model">
                  {whose}
                </span>
                {/* Only for a conversation whose rows *are* the context. A
                  hosted transcript is this app's copy of what the agent said,
                  not what it is carrying. */}
                {!hosted && (
                  <span data-slot="context-gauge-messages">
                    {t('chat.context.messages', { count: reading?.messageCount ?? 0 })}
                  </span>
                )}
                <span data-slot="context-gauge-figures">{figures}</span>
                {hosted ? (
                  // The agent compacts its own history on its own terms, and
                  // this app has no say and no visibility. Saying so beats
                  // leaving a gap where every other conversation has a
                  // countdown.
                  <span data-slot="context-gauge-hosted-compaction" className="m-context-gauge__hosted-note">
                    {t('chat.context.hostedCompaction')}
                  </span>
                ) : (
                  <>
                    {reading?.autoCompactEnabled && reading.compactBreaker !== 'closed' ? (
                      // Before the countdown, and instead of it: "0% until
                      // auto-compact" next to a number that never moves reads as
                      // a bug in the indicator rather than as compaction having
                      // given up.
                      <span data-slot="context-gauge-breaker" className="m-context-gauge__warning">
                        {t('chat.compact.circuitBreakerOpen')}
                      </span>
                    ) : (
                      reading?.autoCompactEnabled &&
                      reading.autoCompactThreshold > 0 && (
                        <span data-slot="context-gauge-countdown">
                          {Math.max(0, Math.round((1 - reading.estimatedTokens / reading.autoCompactThreshold) * 100))}%{' '}
                          {t('chat.compact.untilAutoCompact')}
                        </span>
                      )
                    )}
                    {onCompact && !streaming && (
                      <Link data-slot="context-gauge-compact" className="m-context-gauge__compact" onPress={onCompact}>
                        {t('chat.compact.manual')}
                      </Link>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </PopoverDialog>
      </Popover>
    </DialogTrigger>
  )
}
