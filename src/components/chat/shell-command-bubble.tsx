import './shell-command-bubble.css'
import * as React from 'react'
import { ChevronDown, CircleAlert, CircleCheck, CircleX, Clock, Terminal } from '@keyline-icons/react/two-tone'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import { Hint } from '@/components/ui/hint'
import {
  Bubble,
  BubbleContent,
  BubbleFoldBadge,
  BubbleTime,
  BUBBLE_BLOCK,
} from '@/components/yuerchu-ui/components/chat-bubble/chat-bubble'
import { useClockTime } from '@/hooks/use-clock-time'
import { usePanelExpansion } from '@/hooks/use-panel-expansion'
import { useConversationStore } from '@/stores/conversation-store'
import type { BubblePosition } from '@/lib/message-groups'
import type { MessageViewModel, UserCommandResultResponse } from '@/types'
import { CopyButton } from '@/components/ui/copy-button'

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
  if (commandSucceeded(result)) {
    return <CircleCheck className="m-shell-command-bubble__status-icon" data-tone="success" />
  }
  if (result.status === 'timed_out' || result.status === 'cancelled') {
    return <Clock className="m-shell-command-bubble__status-icon" data-tone="warning" />
  }
  if (result.status === 'in_doubt') {
    return <CircleAlert className="m-shell-command-bubble__status-icon" data-tone="warning" />
  }
  return <CircleX className="m-shell-command-bubble__status-icon" data-tone="danger" />
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
    <Bubble align="end" variant="user" position={position} className="m-shell-command-bubble">
      <BubbleContent className="m-shell-command-bubble__content">
        <div data-slot="shell-command-head" className="m-shell-command-bubble__head">
          <Terminal className="m-shell-command-bubble__terminal" aria-hidden />
          <Hint as="code" className="m-shell-command-bubble__command" label={command}>
            {command}
          </Hint>
          {state.status === 'loading' && <Spinner size="sm" aria-label={t('chat.shell.loading')} />}
          {state.status === 'loaded' && (
            <span
              data-slot="shell-command-outcome"
              className="m-shell-command-bubble__outcome"
              data-command-outcome={commandSucceeded(state.result) ? 'success' : 'failure'}
            >
              <StatusIcon result={state.result} />
              {t(`chat.shell.status.${state.result.status}`)}
              {state.result.exit_code != null && (
                <span data-slot="shell-command-exit-code" className="m-shell-command-bubble__exit-code">
                  · {t('chat.shell.exitCode', { code: state.result.exit_code })}
                </span>
              )}
            </span>
          )}
        </div>
        <div data-slot="shell-command-foot" className="m-shell-command-bubble__foot">
          <BubbleFoldBadge
            expanded={isExpanded}
            aria-controls={isExpanded ? panelId : undefined}
            onPress={() => onExpandedChange(!isExpanded)}
          >
            {t('chat.shell.output')}
            <ChevronDown
              aria-hidden
              data-expanded={isExpanded || undefined}
              className="m-shell-command-bubble__chevron"
            />
          </BubbleFoldBadge>
          {message.created_at > 0 && (
            <BubbleTime dateTime={new Date(message.created_at).toISOString()} className="m-shell-command-bubble__time">
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
          data-failed={failed || undefined}
          className={BUBBLE_BLOCK + ' m-shell-command-bubble__panel'}
        >
          {state.status === 'loaded' && (
            <>
              <div data-slot="shell-command-meta" className="m-shell-command-bubble__meta">
                <Hint className="m-shell-command-bubble__cwd" label={state.result.cwd}>
                  {state.result.cwd}
                </Hint>
                {state.result.host && (
                  <span data-slot="shell-command-host" className="m-shell-command-bubble__host">
                    {state.result.host}
                  </span>
                )}
                <span data-slot="shell-command-duration" className="m-shell-command-bubble__duration">
                  {state.result.duration_ms} ms
                </span>
                {state.result.truncated && (
                  <span data-slot="shell-command-truncated" className="m-shell-command-bubble__truncated">
                    {t('chat.shell.truncated')}
                  </span>
                )}
                {output && <CopyButton text={output} className="m-shell-command-bubble__copy" />}
              </div>
              <pre
                data-slot="shell-command-output"
                data-empty={!output || undefined}
                className="m-shell-command-bubble__output"
              >
                {output || t('chat.shell.noOutput')}
              </pre>
            </>
          )}
          {state.status === 'loading' && (
            <div data-slot="shell-command-placeholder" role="status" aria-busy aria-label={t('chat.shell.loading')}>
              <Skeleton shape="rect" height="4rem" />
            </div>
          )}
          {state.status === 'unavailable' && (
            <p data-slot="shell-command-unavailable" role="status" className="m-shell-command-bubble__unavailable">
              {t('chat.shell.resultUnavailable')}
            </p>
          )}
          {state.status === 'error' && (
            <p data-slot="shell-command-error" role="alert" className="m-shell-command-bubble__error">
              {t('chat.shell.resultError', { error: state.message })}
            </p>
          )}
        </div>
      )}
    </Bubble>
  )
}
