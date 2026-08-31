import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Separator } from '@heroui/react'
import { HoverCard } from '@heroui-pro/react/hover-card'

import { costQualifier, formatCostAmount, type CostQualifier } from '@/lib/cost-format'
import type { TurnUsageSummary } from '@/types'

type TokenTotals = { input: number | null; output: number | null }

function tokenText(tokens: TokenTotals, t: ReturnType<typeof useTranslation>['t']): string | null {
  const input = tokens.input
  const output = tokens.output
  if (input == null && output == null) return null
  if (input != null && output != null) {
    return t('chat.usage.tokensBoth', {
      input: input.toLocaleString(),
      output: output.toLocaleString(),
    })
  }
  return t('chat.usage.tokensOne', { value: (input ?? output ?? 0).toLocaleString() })
}

function persistedTokenText(usage: TurnUsageSummary, t: ReturnType<typeof useTranslation>['t']): string | null {
  if (usage.messages > 0 && usage.missing_token_usage_messages >= usage.messages) {
    return t('chat.usage.tokensUnknown')
  }
  const reported = tokenText({ input: usage.input_tokens, output: usage.output_tokens }, t)
  if (!reported) return null
  return usage.incomplete_token_usage_messages > 0 ? t('chat.usage.tokensPartial', { tokens: reported }) : reported
}

function qualifiedAmount(value: number, qualifier: CostQualifier, t: ReturnType<typeof useTranslation>['t']): string {
  const amount = formatCostAmount(value, qualifier)
  return qualifier === 'partial_estimate' ? t('chat.usage.partialAmount', { amount }) : amount
}

function turnTotalQualifier(usage: TurnUsageSummary): CostQualifier {
  // A mixed turn can also include subscription/external rows. They are not an
  // actionable pricing gap and therefore are not in `unpriced_messages`, but
  // their cost is still absent from this per-turn amount.
  const absentMessages = usage.unpriced_messages + usage.subscription_messages + usage.external_messages
  return costQualifier(absentMessages, usage.estimated_messages)
}

function statusText(usage: TurnUsageSummary, t: ReturnType<typeof useTranslation>['t']): string {
  const isLocal =
    usage.pricing_status === 'exact' || usage.pricing_status === 'estimated' || usage.pricing_status === 'lower_bound'
  if (isLocal && usage.total_cost != null) {
    return qualifiedAmount(usage.total_cost, turnTotalQualifier(usage), t)
  }
  if (isLocal) {
    return t('chat.usage.status.unavailable')
  }
  return t(`chat.usage.status.${usage.pricing_status}`)
}

/**
 * Compact usage summary in the assistant footer, with the backend's priced
 * components one focus or hover away.
 *
 * `usage` is optional for two real cases: a live turn before its post-stop
 * snapshot, and transcript rows written before turn ids existed. Those retain
 * the token text they have always shown and make no cost claim.
 */
export function TurnUsage({ tokens, usage }: { tokens: TokenTotals; usage?: TurnUsageSummary | null }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  // Once the persisted summary exists, its token population is the same one
  // its cost covers (including billed side requests sharing the turn id). The
  // transcript-only totals can be smaller, so they are only the historical and
  // live-turn fallback.
  const tokensLabel = usage ? persistedTokenText(usage, t) : tokenText(tokens, t)
  if (!usage) {
    return tokensLabel ? (
      <span data-slot="turn-usage-summary" className="font-normal tabular-nums">
        {tokensLabel}
      </span>
    ) : null
  }

  const costLabel = statusText(usage, t)
  const summary = tokensLabel ? t('chat.usage.summary', { tokens: tokensLabel, cost: costLabel }) : costLabel
  const priced =
    usage.pricing_status === 'exact' || usage.pricing_status === 'estimated' || usage.pricing_status === 'lower_bound'
  const totalQualifier = turnTotalQualifier(usage)
  const parts = [
    ['input_cost', 'chat.usage.cost.input', 'unpriced_input_messages', 'token'],
    ['cache_cost', 'chat.usage.cost.cache', 'unpriced_cache_messages', 'token'],
    ['output_cost', 'chat.usage.cost.output', 'unpriced_output_messages', 'token'],
    ['tool_cost', 'chat.usage.cost.tools', 'unpriced_tool_messages', 'tool'],
  ] as const

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={300} closeDelay={200}>
      <HoverCard.Trigger className="inline-flex">
        <Button
          variant="ghost"
          size="sm"
          data-slot="turn-usage-summary"
          aria-label={t('chat.usage.openDetails', { summary })}
          aria-expanded={open}
          aria-controls={detailsId}
          onPress={() => setOpen(true)}
          className="touch-hitbox h-auto min-w-0 cursor-[var(--cursor-interactive)] rounded-sm px-0 py-0 font-normal tabular-nums hover:text-foreground"
        >
          {summary}
        </Button>
      </HoverCard.Trigger>
      <HoverCard.Content placement="top" className="w-64 p-3">
        <HoverCard.Arrow />
        <div id={detailsId} role="dialog" aria-label={t('chat.usage.title')} className="space-y-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium text-foreground">{t('chat.usage.title')}</h3>
            {tokensLabel && <p className="text-xs text-muted tabular-nums">{tokensLabel}</p>}
            {usage.incomplete_token_usage_messages > 0 && (
              <p className="text-xs text-muted">
                {t(
                  usage.missing_token_usage_messages >= usage.messages
                    ? 'chat.usage.tokensUnknownHint'
                    : 'chat.usage.tokensPartialHint',
                )}
              </p>
            )}
          </div>

          {priced ? (
            <>
              <dl className="space-y-1.5">
                {parts.map(([key, label, gapKey, kind]) => (
                  <div key={key} className="flex items-center justify-between gap-4 text-xs">
                    <dt className="text-muted">{t(label)}</dt>
                    <dd className="text-foreground tabular-nums">
                      {usage[key] == null
                        ? t('chat.usage.unknownAmount')
                        : qualifiedAmount(
                            usage[key],
                            costQualifier(
                              usage[gapKey],
                              kind === 'token' ? usage.estimated_token_messages : usage.estimated_tool_messages,
                            ),
                            t,
                          )}
                    </dd>
                  </div>
                ))}
              </dl>
              <Separator />
              <dl>
                <div className="flex items-center justify-between gap-4 text-sm font-medium">
                  <dt>{t('chat.usage.cost.total')}</dt>
                  <dd className="tabular-nums">
                    {usage.total_cost == null
                      ? t('chat.usage.unknownAmount')
                      : qualifiedAmount(usage.total_cost, totalQualifier, t)}
                  </dd>
                </div>
              </dl>
              {totalQualifier !== 'exact' && (
                <p className="text-xs text-muted">
                  {t(
                    totalQualifier === 'partial_estimate'
                      ? 'chat.usage.partialEstimate'
                      : totalQualifier === 'estimated'
                        ? 'chat.usage.estimated'
                        : 'chat.usage.lowerBound',
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted">{t(`chat.usage.statusHint.${usage.pricing_status}`)}</p>
          )}
        </div>
      </HoverCard.Content>
    </HoverCard>
  )
}
