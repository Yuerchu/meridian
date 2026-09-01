import * as React from 'react'
import { CircleCheck, CircleExclamation, CircleXmark, Clock, Terminal } from '@gravity-ui/icons'
import { Card, Spinner } from '@heroui/react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import { cn } from '@/lib/utils'
import { Hint } from '@/components/ui/hint'
import { useConversationStore } from '@/stores/conversation-store'
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
  if (commandSucceeded(result)) return <CircleCheck className="size-3.5 text-success" />
  if (result.status === 'timed_out' || result.status === 'cancelled') {
    return <Clock className="size-3.5 text-warning" />
  }
  if (result.status === 'in_doubt') return <CircleExclamation className="size-3.5 text-warning" />
  return <CircleXmark className="size-3.5 text-danger" />
}

/** A persisted `!` turn. The visible row remains the command the user typed;
 *  output is rehydrated through the narrow shell-result endpoint so ordinary
 *  transcript snapshots never carry raw injected context. */
export function ShellCommandCard({ message }: { message: MessageViewModel }) {
  const { t } = useTranslation()
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })
  const command = message.content.startsWith('!') ? message.content.slice(1) : message.content
  const active = useConversationStore(
    (store) => store.sessions[message.conversation_id]?.activeShellTurnId === message.turn_id,
  )
  const resultKey = useConversationStore(
    (store) => store.sessions[message.conversation_id]?.shellResultKeys?.[message.id],
  )

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

  return (
    <Card className="w-full max-w-[92%] overflow-hidden border border-divider bg-surface shadow-none">
      <Card.Header className="flex min-w-0 items-center gap-2 border-b border-divider px-3 py-2">
        <Terminal className="size-4 shrink-0 text-muted" />
        <Hint as="code" className="min-w-0 flex-1 truncate text-xs text-foreground" label={command}>
          {command}
        </Hint>
        {state.status === 'loading' && <Spinner size="sm" aria-label={t('chat.shell.loading')} />}
        {state.status === 'loaded' && (
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 text-xs',
              commandSucceeded(state.result) ? 'text-muted' : 'text-danger',
            )}
            data-command-outcome={commandSucceeded(state.result) ? 'success' : 'failure'}
          >
            <StatusIcon result={state.result} />
            {t(`chat.shell.status.${state.result.status}`)}
            {state.result.exit_code != null && (
              <span>· {t('chat.shell.exitCode', { code: state.result.exit_code })}</span>
            )}
          </span>
        )}
        {output && <CopyButton text={output} className="size-7 shrink-0 rounded-md" />}
      </Card.Header>

      <Card.Content className="gap-0 p-0">
        {state.status === 'loaded' && (
          <>
            <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 border-b border-divider px-3 py-1.5 font-mono text-xs text-muted">
              <Hint className="truncate" label={state.result.cwd}>
                {state.result.cwd}
              </Hint>
              {state.result.host && <span className="shrink-0">{state.result.host}</span>}
              <span className="shrink-0">{state.result.duration_ms} ms</span>
              {state.result.truncated && <span className="shrink-0 text-warning">{t('chat.shell.truncated')}</span>}
            </div>
            <pre
              className={cn(
                'max-h-80 min-h-10 overflow-auto whitespace-pre-wrap wrap-break-word px-3 py-2.5 font-mono text-xs leading-5',
                output ? 'text-foreground/85' : 'italic text-muted',
              )}
            >
              {output || t('chat.shell.noOutput')}
            </pre>
          </>
        )}
        {state.status === 'loading' && <div className="h-16 animate-pulse bg-default/30" />}
        {state.status === 'unavailable' && (
          <p role="status" className="px-3 py-3 text-xs text-muted">
            {t('chat.shell.resultUnavailable')}
          </p>
        )}
        {state.status === 'error' && (
          <p role="alert" className="px-3 py-3 text-xs text-danger wrap-break-word">
            {t('chat.shell.resultError', { error: state.message })}
          </p>
        )}
      </Card.Content>
    </Card>
  )
}
