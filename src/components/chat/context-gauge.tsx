import { useTranslation } from 'react-i18next'

import { Button, Popover, ProgressCircle } from '@heroui/react'

import type { AcpUsage } from '@/hooks/use-acp-config'

/** What the composer knows about this conversation's window. */
export interface ContextReading {
  messageCount: number
  estimatedTokens: number
  contextLimit: number
  autoCompactEnabled: boolean
  autoCompactThreshold: number
  /** `closed` while compaction is being attempted. Anything else means enough
   *  summarisations failed in a row that it has stopped trying — the setting is
   *  still on, and the count will only keep climbing, so it has to be said. */
  compactBreaker: string
  /** Whose window the numbers above describe. */
  model: string
  /** `agent` / `explore` for a delegated run, `claude_code` for a hosted
   *  session, absent for an ordinary conversation. */
  agentKind?: string
}

interface ContextGaugeProps {
  context?: ContextReading
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
}: ContextGaugeProps) {
  const { t } = useTranslation()

  const used = hosted ? agentUsage?.used : context?.estimatedTokens
  const limit = hosted ? agentUsage?.size : context?.contextLimit
  if (used === undefined || !limit) return null
  if (!hosted && (!context || context.messageCount === 0)) return null

  const ratio = used / limit
  // Below the warning threshold the ring is ambient, not a reading — quieter
  // than `color="default"`, which is a foreground shade.
  const color = ratio > 0.95 ? 'danger' : ratio > 0.8 ? 'warning' : undefined
  const figures = t('chat.context.tokens', {
    used: used.toLocaleString(),
    limit: limit.toLocaleString(),
  })

  // A delegated run has its own model and its own limit, so the same percentage
  // means a different number of tokens — and the conversation it was started
  // from is one tap away, which is exactly when that gets confusing. Only those
  // two kinds are sub-agents; a hosted session is a peer, and reading any
  // non-empty `agentKind` as "sub-agent" labelled it `子 Agent（Agent）`.
  const subAgent = context?.agentKind === 'agent' || context?.agentKind === 'explore'
  const whose = hosted
    ? (agentModel ?? t('chat.context.hostedAgent'))
    : subAgent
      ? t('chat.context.forSubAgent', {
          kind: t(`chat.subAgent.${context?.agentKind === 'explore' ? 'explore' : 'agent'}`),
          model: context?.model,
        })
      : context?.model

  return (
    // A popover rather than a tooltip. This panel has a button in it, and a
    // tooltip is not a place a button can live: it is announced as a
    // description, it closes when the pointer leaves on the way to what it
    // contains, and nothing in it is reachable from the keyboard.
    <Popover>
      {/* The dial is 18px, and on a touch screen it is the only way to what the
          turn is costing and to compacting by hand. The expanded hit area loses
          a pixel at the bottom — the composer shell clips and the toolbar sits
          12px off its edge, against the 13px each side needs to reach 44 — which
          is worth saying because it is the reason this is not simply a larger
          button: the toolbar row is 32px, and a control taller than that pushes
          the shell open. */}
      <Popover.Trigger
        aria-label={figures}
        className="touch-hitbox inline-flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ProgressCircle
          aria-hidden
          value={used}
          maxValue={limit}
          isIndeterminate={compacting}
          color={color}
          className={color && !compacting ? undefined : '[--progress-circle-stroke:var(--muted)]'}
        >
          <ProgressCircle.Track className="size-4.5">
            <ProgressCircle.TrackCircle />
            <ProgressCircle.FillCircle />
          </ProgressCircle.Track>
        </ProgressCircle>
      </Popover.Trigger>
      <Popover.Content placement="top" className="max-w-64">
        <Popover.Dialog className="flex flex-col gap-1 text-xs tabular-nums">
          {compacting && !hosted ? (
            <span>{t('chat.compact.inProgress')}</span>
          ) : (
            <>
              <span className="text-muted">{whose}</span>
              {/* Only for a conversation whose rows *are* the context. A
                  hosted transcript is this app's copy of what the agent said,
                  not what it is carrying. */}
              {!hosted && <span>{t('chat.context.messages', { count: context?.messageCount ?? 0 })}</span>}
              <span>{figures}</span>
              {hosted ? (
                // The agent compacts its own history on its own terms, and
                // this app has no say and no visibility. Saying so beats
                // leaving a gap where every other conversation has a
                // countdown.
                <span className="text-muted">{t('chat.context.hostedCompaction')}</span>
              ) : (
                <>
                  {context?.autoCompactEnabled && context.compactBreaker !== 'closed' ? (
                    // Before the countdown, and instead of it: "0% until
                    // auto-compact" next to a number that never moves reads as
                    // a bug in the indicator rather than as compaction having
                    // given up.
                    <span className="text-warning">{t('chat.compact.circuitBreakerOpen')}</span>
                  ) : (
                    context?.autoCompactEnabled &&
                    context.autoCompactThreshold > 0 && (
                      <span>
                        {Math.max(0, Math.round((1 - context.estimatedTokens / context.autoCompactThreshold) * 100))}%{' '}
                        {t('chat.compact.untilAutoCompact')}
                      </span>
                    )
                  )}
                  {onCompact && !streaming && (
                    <Button
                      variant="ghost"
                      className="mt-1 h-auto justify-start px-0 py-0 text-xs font-normal underline underline-offset-2"
                      onPress={onCompact}
                    >
                      {t('chat.compact.manual')}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
