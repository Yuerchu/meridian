import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Disclosure, Skeleton } from '@heroui/react'
import { File, Magnifier, TerminalLine } from '@gravity-ui/icons'
import { api } from '@/api'
import { hydrateBlocks } from '@/stores/conversation-store'
import { buildTurns } from '@/lib/turns'
import { buildAssistantGroups, type BubbleModel, type FoldKind, type FoldedCalls } from '@/lib/message-groups'
import { cn } from '@/lib/utils'
import { BubbleFoldBadge } from '@/components/ui/bubble-keyboard'
import { identifyingArg, toolLabel } from './tool-call-block'
import { PathLabel } from '@/components/ui/path-label'
import type { SubAgentRunDisplay, ToolCallDisplay } from '@/types'

/**
 * What a delegated run did, step by step, drawn inside the card that started
 * it.
 *
 * The run's transcript is a conversation of its own, and the only way to read
 * it is the same snapshot the chat view loads — so it is fetched here, once,
 * the first time the reader opens the steps, and again while the run is live
 * whenever its step counter moves. The rows are then cut into bubbles by the
 * same projection the transcript uses, and each assistant row becomes one
 * step: the first paragraph of what it said, its folded calls as the badges
 * the transcript would show, and the calls that stayed keys by name. Nothing
 * here opens: a badge on a step is a count, not a disclosure, because the keys
 * it stands for would need a keyboard stack of their own.
 *
 * Only the run's own turn is drawn. The conversation may hold later turns —
 * whatever the user typed into it after the run — and this card reports on
 * one delegation.
 */

interface Step {
  key: string
  text: string | null
  folded: FoldedCalls[]
  keys: ToolCallDisplay[]
  working: boolean
}

const FOLD_ICONS: Record<FoldKind, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  commands: TerminalLine,
  files: File,
  searches: Magnifier,
}

function stepsOf(bubbles: BubbleModel[]): Step[] {
  const steps: Step[] = []
  for (const b of bubbles) {
    switch (b.kind) {
      case 'text':
        steps.push({ key: b.key, text: b.text.split(/\n\s*\n/)[0], folded: b.folded, keys: b.tools, working: false })
        break
      case 'keyboard-only':
        steps.push({ key: b.key, text: null, folded: b.folded, keys: b.tools, working: false })
        break
      case 'summary':
        steps.push({ key: b.key, text: null, folded: b.folded, keys: [], working: false })
        break
      case 'working':
        steps.push({ key: b.key, text: null, folded: [], keys: [], working: true })
        break
      default:
        break
    }
  }
  return steps
}

type Loaded = { kind: 'steps'; steps: Step[] } | { kind: 'error'; message: string }

export function SubAgentTimeline({ run, live, count }: { run: SubAgentRunDisplay; live: boolean; count: number }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)

  const fetchSteps = useCallback(() => {
    const mine = ++generation.current
    setLoading(true)
    api
      .conversationSnapshot({ conversationId: run.conversation_id })
      .then((snap) => {
        if (mine !== generation.current) return
        const rows = hydrateBlocks(
          snap.tree.messages,
          snap.pending_approvals,
          snap.turns,
          snap.sub_agent_runs,
          snap.plan_reviews,
        ).filter((m) => m.turn_id === run.turn_id)
        const steps = buildTurns(rows, { streaming: live }).flatMap((turn) =>
          buildAssistantGroups(turn).flatMap((group) => stepsOf(group.bubbles)),
        )
        setLoaded({ kind: 'steps', steps })
      })
      .catch((error: unknown) => {
        if (mine !== generation.current) return
        setLoaded({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false)
      })
  }, [run.conversation_id, run.turn_id, live])

  // The first opening loads; every later step of a live run reloads, so an
  // open timeline keeps up rather than freezing at the step it was opened on.
  useEffect(() => {
    if (expanded) fetchSteps()
  }, [expanded, fetchSteps, count])

  const steps = useMemo(() => (loaded?.kind === 'steps' ? loaded.steps : []), [loaded])

  return (
    <div
      data-slot="sub-agent-timeline"
      className="flex min-w-0 flex-col"
      // Escape on the steps closes the steps and no more; with them shut it
      // reaches the panel, which closes itself the way it always has.
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded && !event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          event.stopPropagation()
          setExpanded(false)
        }
      }}
    >
      <Disclosure isExpanded={expanded} onExpandedChange={setExpanded} className="flex min-w-0 flex-col">
        <Disclosure.Trigger
          data-slot="sub-agent-timeline-trigger"
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-muted transition-colors outline-none hover:bg-default/60 focus-visible:ring-2 focus-visible:ring-focus/50"
        >
          <span className="font-medium text-foreground">{t('chat.tool.panel.process')}</span>
          {count > 0 && <span className="tabular-nums">{t('chat.subAgent.steps', { count })}</span>}
          <Disclosure.Indicator className="ms-auto size-3 shrink-0" />
        </Disclosure.Trigger>
        <Disclosure.Content className="min-h-0">
          <Disclosure.Body className="p-0">
            {loaded === null || (loading && loaded.kind === 'error') ? (
              <div
                role="status"
                aria-busy
                aria-label={t('chat.tool.panel.processLoading')}
                className="space-y-2 px-3 py-2"
              >
                <Skeleton className="h-3 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/2 rounded" />
                <Skeleton className="h-3 w-2/3 rounded" />
              </div>
            ) : loaded.kind === 'error' ? (
              <div className="px-3 py-2 text-xs text-danger">
                {t('chat.tool.panel.processFailed', { error: loaded.message })}
              </div>
            ) : steps.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted">{t('chat.tool.panel.processEmpty')}</div>
            ) : (
              <ol data-slot="sub-agent-steps" className="relative px-3 py-1">
                {steps.map((step, index) => (
                  <li
                    key={step.key}
                    data-slot="sub-agent-step"
                    className="relative flex min-w-0 gap-2.5 py-1 text-xs before:absolute before:top-[0.9rem] before:bottom-[-0.35rem] before:left-[0.3rem] before:w-px before:bg-border last:before:hidden"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-[0.45rem] size-2.5 shrink-0 rounded-full ring-2 ring-surface',
                        step.working ? 'animate-pulse bg-accent motion-reduce:animate-none' : 'bg-border',
                        index === steps.length - 1 && !step.working && !live && 'bg-success-soft-foreground',
                      )}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {step.text !== null && <p className="line-clamp-2 min-w-0 text-foreground/90">{step.text}</p>}
                      {(step.folded.length > 0 || step.keys.length > 0) && (
                        <div className="flex min-w-0 flex-wrap items-center gap-1">
                          {step.folded.map((fold) => {
                            const Icon = FOLD_ICONS[fold.kind]
                            return (
                              <BubbleFoldBadge
                                key={fold.key}
                                expanded={false}
                                disabled
                                className="disabled:opacity-100"
                              >
                                <Icon aria-hidden className="size-3" />
                                {t(`chat.tool.fold.${fold.kind}`, { count: fold.count })}
                              </BubbleFoldBadge>
                            )
                          })}
                          {step.keys.map((tool) => {
                            const arg = identifyingArg(tool.tool_name, parseArgs(tool.arguments))
                            return (
                              <span
                                key={tool.call_id}
                                data-slot="sub-agent-step-key"
                                data-status={tool.status}
                                className="inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-full bg-default/70 px-2 text-xs leading-none text-muted"
                              >
                                <span className="shrink-0 text-foreground">{toolLabel(t, tool.tool_name)}</span>
                                {arg?.kind === 'path' ? (
                                  <PathLabel path={arg.value} className="min-w-0" />
                                ) : arg ? (
                                  <span className="min-w-0 truncate font-mono">{arg.value.split('\n')[0]}</span>
                                ) : null}
                              </span>
                            )
                          })}
                        </div>
                      )}
                      {step.working && <p className="shimmer text-muted">{t('chat.tool.panel.status.running')}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
    </div>
  )
}

function parseArgs(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
