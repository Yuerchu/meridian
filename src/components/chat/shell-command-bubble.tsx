import * as React from 'react'
import { ChevronDown, CircleCheck, CircleExclamation, CircleXmark, Clock, Terminal } from '@gravity-ui/icons'
import { Skeleton, Spinner } from '@/components/base'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import { cx } from '@/utils/cx'
import { Hint } from '@/components/ui/hint'
import { Bubble, BubbleContent, BubbleTime, BUBBLE_BLOCK } from '@/components/ui/bubble'
import { BubbleFoldBadge } from '@/components/ui/bubble-block'
import { useClockTime } from '@/hooks/use-clock-time'
import { usePanelExpansion } from '@/hooks/use-panel-expansion'
import { useConversationStore } from '@/stores/conversation-store'
import type { BubblePosition } from '@/lib/message-groups'
import type { MessageViewModel, UserCommandResultResponse } from '@/types'
import { CopyButton } from './markdown-content'

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; result: UserCommandResultResponse }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

function resultText(result: UserCommandResultResponse): string {
  const parts: string[] = []
  if (result.stdout) parts.push(result.stdout)
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
  if (result.error) parts.push(`[error]\n${result.error}`)
  return parts.join('\n')
}

function commandSucceeded(result: UserCommandResultResponse): boolean {
  return result.status === 'completed' && result.exit_code === 0
}

function StatusIcon({ result }: { result: UserCommandResultResponse }) {
  if (commandSucceeded(result)) return <CircleCheck className="size-3.5 text-status-success" />
  if (result.status === 'timed_out' || result.status === 'cancelled') {
    return <Clock className="size-3.5 text-status-warning" />
  }
  if (result.status === 'in_doubt') return <CircleExclamation className="size-3.5 text-status-warning" />
  return <CircleXmark className="size-3.5 text-status-danger" />
}

/**
 * A persisted `!` turn, as a bubble on the person's side of the transcript.
 *
 * The command is what they said, so it takes the user bubble: the command at
 * its head with the outcome beside it, and at its foot a badge that opens the
 * output and the time — the shape a prose bubble has, with its badges and
 * time on the last line. The output is a panel under the bubble in the
 * keyboard-panel style, open by default (a result the person asked for is
 * not something to hide) and remembered per bubble like every other panel;
 * a failed command's panel carries the error ring a failed tool's does.
 *
 * It used to be a `Card` with its own border and header, which was the one
 * thing on the user's side of the transcript drawn in a different system.
 *
 * The visible row remains the command the user typed; output is rehydrated
 * through the narrow shell-result endpoint so ordinary transcript snapshots
 * never carry raw injected context.
 */
export function ShellCommandBubble({
  message,
  position = 'single',
}: {
  message: MessageViewModel
  position?: BubblePosition
}) {
  const { t } = useTranslation()
  const clock = useClockTime()
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })
  const command = message.content.startsWith('!') ? message.content.slice(1) : message.content
  const active = useConversationStore(
    (store) => store.sessions[message.conversation_id]?.activeShellTurnId === message.turn_id,
  )
  const resultKey = useConversationStore(
    (store) => store.sessions[message.conversation_id]?.shellResultKeys?.[message.id],
  )
  const { isExpanded, onExpandedChange } = usePanelExpansion(`${message.id}:shell`, true, false)
  const panelId = `shell-${message.id.replace(/[^\w-]/g, '_')}`

  React.useEffect(() => {
    if (active) {
      setState({ status: 'loading' })
      return
    }
    let live = true
    setState({ status: 'loading' })
    void api.getUserCommandResult({ conversationId: message.conversation_id, messageId: message.id }).then(
      (result) => {
        if (!live) return
        setState(result ? { status: 'loaded', result } : { status: 'unavailable' })
      },
      (error) => {
        if (live) setState({ status: 'error', message: String(error) })
      },
    )
    return () => {
      live = false
    }
  }, [active, message.conversation_id, message.id, resultKey])

  const output = state.status === 'loaded' ? resultText(state.result) : ''
  const failed = state.status === 'loaded' && !commandSucceeded(state.result)

  return (
    <Bubble align="end" variant="user" position={position} className="w-full max-w-[85%]">
      <BubbleContent className="w-full">
        <div data-slot="shell-command-head" className="flex min-w-0 items-center gap-2">
          <Terminal className="size-3.5 shrink-0 opacity-70" aria-hidden />
          <Hint as="code" className="min-w-0 flex-1 truncate font-mono text-xs" label={command}>
            {command}
          </Hint>
          {state.status === 'loading' && <Spinner size="sm" color="current" aria-label={t('chat.shell.loading')} />}
          {state.status === 'loaded' && (
            <span
              data-slot="shell-command-outcome"
              className={cx(
                'flex shrink-0 items-center gap-1 text-xs',
                commandSucceeded(state.result) ? 'opacity-70' : 'text-status-danger',
              )}
              data-command-outcome={commandSucceeded(state.result) ? 'success' : 'failure'}
            >
              <StatusIcon result={state.result} />
              {t(`chat.shell.status.${state.result.status}`)}
              {state.result.exit_code != null && (
                <span data-slot="shell-command-exit-code" className="tabular-nums">
                  · {t('chat.shell.exitCode', { code: state.result.exit_code })}
                </span>
              )}
            </span>
          )}
        </div>
        <div data-slot="shell-command-foot" className="mt-1.5 flex min-w-0 items-center justify-between gap-3">
          <BubbleFoldBadge
            expanded={isExpanded}
            aria-controls={isExpanded ? panelId : undefined}
            onClick={() => onExpandedChange(!isExpanded)}
          >
            {t('chat.shell.output')}
            <ChevronDown aria-hidden className={cx('size-3 transition-transform', isExpanded && 'rotate-180')} />
          </BubbleFoldBadge>
          {message.created_at > 0 && (
            <BubbleTime dateTime={new Date(message.created_at).toISOString()} className="opacity-70">
              {clock.format(message.created_at)}
            </BubbleTime>
          )}
        </div>
      </BubbleContent>

      {isExpanded && (
        // A second block of the same bubble, which is where its fill and its
        // shared corner come from. `BUBBLE_BLOCK` reads `--bubble-fill`, so
        // this one comes out in the person's colour without being told: it is
        // the only block that is not on the assistant's side.
        <div
          id={panelId}
          data-slot="shell-command-panel"
          data-bubble-block=""
          className={cx(BUBBLE_BLOCK, 'w-full text-xs', failed && 'ring-1 ring-status-danger/40 ring-inset')}
        >
          {state.status === 'loaded' && (
            <>
              <div
                data-slot="shell-command-meta"
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-2 font-mono text-xs text-text-secondary"
              >
                <Hint className="truncate" label={state.result.cwd}>
                  {state.result.cwd}
                </Hint>
                {state.result.host && (
                  <span data-slot="shell-command-host" className="shrink-0">
                    {state.result.host}
                  </span>
                )}
                <span data-slot="shell-command-duration" className="shrink-0 tabular-nums">
                  {state.result.duration_ms} ms
                </span>
                {state.result.truncated && (
                  <span data-slot="shell-command-truncated" className="shrink-0 text-status-warning-soft-foreground">
                    {t('chat.shell.truncated')}
                  </span>
                )}
                {output && <CopyButton text={output} className="ms-auto size-6 rounded-md" />}
              </div>
              <pre
                data-slot="shell-command-output"
                className={cx(
                  'max-h-80 min-h-10 overflow-auto px-3 py-2.5 font-mono text-xs leading-5 whitespace-pre-wrap wrap-break-word',
                  output ? 'text-text-primary' : 'text-text-secondary italic',
                )}
              >
                {output || t('chat.shell.noOutput')}
              </pre>
            </>
          )}
          {state.status === 'loading' && (
            <Skeleton
              data-slot="shell-command-placeholder"
              className="h-16 rounded-xl"
              role="status"
              aria-busy
              aria-label={t('chat.shell.loading')}
            />
          )}
          {state.status === 'unavailable' && (
            <p data-slot="shell-command-unavailable" role="status" className="px-3 py-3 text-xs text-text-secondary">
              {t('chat.shell.resultUnavailable')}
            </p>
          )}
          {state.status === 'error' && (
            <p
              data-slot="shell-command-error"
              role="alert"
              className="px-3 py-3 text-xs wrap-break-word text-status-danger-soft-foreground"
            >
              {t('chat.shell.resultError', { error: state.message })}
            </p>
          )}
        </div>
      )}
    </Bubble>
  )
}
