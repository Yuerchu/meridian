import { useTranslation } from 'react-i18next'
import { Info } from '@keyline-icons/react/two-tone'

import { Popover, Separator } from '@/components/base'
import { ActionButton } from '@/components/ui/action-button'
import { costQualifier, formatCostAmount, type CostQualifier } from '@/lib/cost-format'
import { formatDuration } from '@/lib/turns'
import type { DecimalString, TurnUsageInfoResponse } from '@/types'
import { cx } from '@/utils/cx'

type T = ReturnType<typeof useTranslation>['t']
type TokenTotals = { input: number | null; output: number | null }

/**
 * One line of the turn's details. A new metric (time to first token, tokens
 * per second, …) is one more of these in the section it belongs to — nothing
 * about the popover changes.
 */
interface TurnInfoRow {
  id: string
  label: string
  value: string
  /** The line a section sums up to; drawn under a rule, in the stronger weight. */
  total?: boolean
}

interface TurnInfoSection {
  id: 'time' | 'tokens' | 'cost'
  title: string
  rows: TurnInfoRow[]
  /** Qualifications of the rows above: estimated, lower bound, not reported. */
  notes: string[]
}

interface TurnInfoInput {
  tokens: TokenTotals
  usage?: TurnUsageInfoResponse | null
  durationMs?: number | null
  isStreaming?: boolean
}

function tokenText(tokens: TokenTotals, t: T): string | null {
  const { input, output } = tokens
  if (input == null && output == null) return null
  if (input != null && output != null) {
    return t('chat.usage.tokensBoth', { input: input.toLocaleString(), output: output.toLocaleString() })
  }
  return t('chat.usage.tokensOne', { value: (input ?? output ?? 0).toLocaleString() })
}

function persistedTokenText(usage: TurnUsageInfoResponse, t: T): string | null {
  if (usage.messages > 0 && usage.missing_token_usage_messages >= usage.messages) {
    return t('chat.usage.tokensUnknown')
  }
  const reported = tokenText({ input: usage.input_tokens, output: usage.output_tokens }, t)
  if (!reported) return null
  return usage.incomplete_token_usage_messages > 0 ? t('chat.usage.tokensPartial', { tokens: reported }) : reported
}

function qualifiedAmount(value: DecimalString, qualifier: CostQualifier, t: T): string {
  const amount = formatCostAmount(value, qualifier)
  return qualifier === 'partial_estimate' ? t('chat.usage.partialAmount', { amount }) : amount
}

function turnTotalQualifier(usage: TurnUsageInfoResponse): CostQualifier {
  // A mixed turn can also include subscription/external rows. They are not an
  // actionable pricing gap and therefore are not in `unpriced_messages`, but
  // their cost is still absent from this per-turn amount.
  const absentMessages = usage.unpriced_messages + usage.subscription_messages + usage.external_messages
  return costQualifier(absentMessages, usage.estimated_messages)
}

function isLocallyPriced(usage: TurnUsageInfoResponse): boolean {
  return (
    usage.pricing_status === 'exact' || usage.pricing_status === 'estimated' || usage.pricing_status === 'lower_bound'
  )
}

function tokensSection(input: TurnInfoInput, t: T): TurnInfoSection | null {
  const { usage, tokens } = input
  const rows: TurnInfoRow[] = []
  const notes: string[] = []
  // Once the persisted summary exists, its token population is the same one
  // its cost covers (including billed side requests sharing the turn id). The
  // transcript-only totals can be smaller, so they are only the historical and
  // live-turn fallback.
  if (usage) {
    const allMissing = usage.messages > 0 && usage.missing_token_usage_messages >= usage.messages
    if (!allMissing) {
      const count = (n: number) => n.toLocaleString()
      rows.push({ id: 'input', label: t('chat.turnInfo.tokens.input'), value: count(usage.input_tokens) })
      rows.push({ id: 'output', label: t('chat.turnInfo.tokens.output'), value: count(usage.output_tokens) })
      if (usage.cache_read_tokens > 0) {
        rows.push({
          id: 'cache-read',
          label: t('chat.turnInfo.tokens.cacheRead'),
          value: count(usage.cache_read_tokens),
        })
      }
      if (usage.cache_write_tokens > 0) {
        rows.push({
          id: 'cache-write',
          label: t('chat.turnInfo.tokens.cacheWrite'),
          value: count(usage.cache_write_tokens),
        })
      }
    }
    const summary = persistedTokenText(usage, t)
    if (summary) rows.push({ id: 'total', label: t('chat.turnInfo.tokens.total'), value: summary, total: true })
    if (usage.incomplete_token_usage_messages > 0) {
      notes.push(t(allMissing ? 'chat.usage.tokensUnknownHint' : 'chat.usage.tokensPartialHint'))
    }
  } else {
    if (tokens.input != null) {
      rows.push({ id: 'input', label: t('chat.turnInfo.tokens.input'), value: tokens.input.toLocaleString() })
    }
    if (tokens.output != null) {
      rows.push({ id: 'output', label: t('chat.turnInfo.tokens.output'), value: tokens.output.toLocaleString() })
    }
    const summary = tokenText(tokens, t)
    if (summary && rows.length > 1) {
      rows.push({ id: 'total', label: t('chat.turnInfo.tokens.total'), value: summary, total: true })
    }
  }
  return rows.length > 0 || notes.length > 0
    ? { id: 'tokens', title: t('chat.turnInfo.section.tokens'), rows, notes }
    : null
}

function costSection(usage: TurnUsageInfoResponse, t: T): TurnInfoSection {
  const title = t('chat.turnInfo.section.cost')
  // Subscription and external billing — which includes every hosted (ACP)
  // turn — are reported, never priced: there is no rate here to apply, and a
  // number computed anyway would look authoritative and be wrong.
  if (!isLocallyPriced(usage)) {
    return {
      id: 'cost',
      title,
      rows: [
        {
          id: 'status',
          label: t('chat.turnInfo.cost.billing'),
          value: t(`chat.usage.status.${usage.pricing_status}`),
        },
      ],
      notes: [t(`chat.usage.statusHint.${usage.pricing_status}`)],
    }
  }
  const parts = [
    ['input_cost', 'chat.usage.cost.input', 'unpriced_input_messages', 'token'],
    ['cache_cost', 'chat.usage.cost.cache', 'unpriced_cache_messages', 'token'],
    ['output_cost', 'chat.usage.cost.output', 'unpriced_output_messages', 'token'],
    ['tool_cost', 'chat.usage.cost.tools', 'unpriced_tool_messages', 'tool'],
  ] as const
  const rows: TurnInfoRow[] = parts.map(([key, label, gapKey, kind]) => {
    const value = usage[key]
    return {
      id: key,
      label: t(label),
      value:
        value == null
          ? t('chat.usage.unknownAmount')
          : qualifiedAmount(
              value,
              costQualifier(
                usage[gapKey],
                kind === 'token' ? usage.estimated_token_messages : usage.estimated_tool_messages,
              ),
              t,
            ),
    }
  })
  const totalQualifier = turnTotalQualifier(usage)
  rows.push({
    id: 'total',
    label: t('chat.usage.cost.total'),
    value:
      usage.total_cost == null ? t('chat.usage.unknownAmount') : qualifiedAmount(usage.total_cost, totalQualifier, t),
    total: true,
  })
  const notes: string[] = []
  if (totalQualifier !== 'exact') {
    notes.push(
      t(
        totalQualifier === 'partial_estimate'
          ? 'chat.usage.partialEstimate'
          : totalQualifier === 'estimated'
            ? 'chat.usage.estimated'
            : 'chat.usage.lowerBound',
      ),
    )
  }
  return { id: 'cost', title, rows, notes }
}

/**
 * Everything known about one turn beyond its text, as sections of rows. Pure,
 * so the shape of the popover is testable without opening it and a new metric
 * is added here rather than in markup.
 */
function turnInfoSections(input: TurnInfoInput, t: T): TurnInfoSection[] {
  const sections: TurnInfoSection[] = []
  if (input.durationMs != null && !input.isStreaming) {
    sections.push({
      id: 'time',
      title: t('chat.turnInfo.section.time'),
      rows: [{ id: 'duration', label: t('chat.turnInfo.duration'), value: formatDuration(input.durationMs) }],
      notes: [],
    })
  }
  const tokens = tokensSection(input, t)
  if (tokens) sections.push(tokens)
  if (input.usage) sections.push(costSection(input.usage, t))
  return sections
}

/**
 * The turn's details — duration, tokens, cost — behind one icon in the
 * message's action row. They used to be a cost pill and a duration in the
 * footer with the token counts one hover further; every figure added there
 * made the footer a ledger line, and a secondary panel has room for the next
 * one (time to first token) without anyone reading it beside every answer.
 */
export function TurnInfo(props: TurnInfoInput) {
  const { t } = useTranslation()
  const sections = turnInfoSections(props, t)
  if (sections.length === 0) return null
  const label = t('chat.turnInfo.open')

  return (
    <Popover>
      <ActionButton label={label} icon={Info} />
      <Popover.Content placement="top" className="w-72">
        <Popover.Dialog aria-label={label} data-slot="turn-info" className="space-y-3 p-0.5">
          {sections.map((section, index) => (
            <section
              key={section.id}
              data-slot="turn-info-section"
              data-section={section.id}
              aria-labelledby={`turn-info-${section.id}`}
              className="space-y-1.5"
            >
              {index > 0 && <Separator className="mb-3" />}
              <h3
                id={`turn-info-${section.id}`}
                data-slot="turn-info-section-title"
                className="text-caption-1-medium text-text-secondary"
              >
                {section.title}
              </h3>
              <dl data-slot="turn-info-rows" className="space-y-1">
                {section.rows.map((row) => (
                  <div
                    key={row.id}
                    data-slot="turn-info-row"
                    data-row={row.id}
                    className={cx(
                      'flex items-center justify-between gap-4',
                      row.total ? 'text-body-2-medium text-text-primary' : 'text-caption-1-regular',
                    )}
                  >
                    <dt data-slot="turn-info-row-label" className={cx(!row.total && 'text-text-secondary')}>
                      {row.label}
                    </dt>
                    <dd data-slot="turn-info-row-value" className="text-text-primary tabular-nums">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {section.notes.map((note) => (
                <p key={note} data-slot="turn-info-note" className="text-caption-1-regular text-text-secondary">
                  {note}
                </p>
              ))}
            </section>
          ))}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
