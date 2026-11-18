import './background-tasks-chip.css'
import { DialogTrigger, Dialog as PopoverDialog, Button as PopoverButton } from 'react-aria-components'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FileText, SquareTerminal, Stop } from '@keyline-icons/react/two-tone'
import { Sheet } from '@/components/base'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { ErrorAlert } from '@/components/ui/error-alert'

import { api } from '@/api'
import { elapsedLabel } from '@/lib/elapsed'
import { errorMessage } from '@/lib/error-message'
import type { BackgroundTaskInfoResponse } from '@/types'

/** A clock that ticks once a second while `active`, and stands still otherwise. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/**
 * The commands this conversation left running, as a chip in the composer's
 * status tab: a spinner and the count, and the list one press away.
 *
 * Beside the checklist's chip because it is the same kind of fact — what the
 * conversation is doing while nobody is typing — and a card pinned over the
 * composer for it would take a row of the transcript for as long as a server
 * runs. Only the running ones: a finished task is told to the model, which is
 * where its ending is read, and the card that started it says what it was.
 *
 * The caller passes running tasks only, and nothing at all when there are
 * none: an element that renders nothing still holds the status tab open.
 */
export function BackgroundTasksChip({
  conversationId,
  tasks,
  onStop,
}: {
  conversationId: string
  tasks: BackgroundTaskInfoResponse[]
  onStop: (id: string) => void
}) {
  const { t } = useTranslation()
  const now = useNow(tasks.length > 0)
  const [reading, setReading] = useState<BackgroundTaskInfoResponse | null>(null)
  const label = t('chat.background.running', { count: tasks.length })
  // Short on the tab, where it sits beside the checklist's chip and the
  // branch; the full sentence is the name a screen reader hears.
  const short = t('chat.background.chip', { count: tasks.length })

  return (
    <>
      <DialogTrigger>
        <PopoverButton
          data-slot="background-tasks-chip"
          aria-label={label}
          className="m-background-tasks-chip__trigger"
        >
          {/* Still, and not a spinner: the checklist's ring beside it is a
              circle that moves, and two of them read as one thing twice. */}
          <SquareTerminal className="m-background-tasks-chip__icon" aria-hidden />
          <span data-slot="background-tasks-chip-label" className="m-background-tasks-chip__count">
            {short}
          </span>
        </PopoverButton>
        <Popover offset={8} placement="top start" className="m-background-tasks-chip__panel-1">
          <PopoverDialog aria-label={label}>
            <div className="m-background-tasks-chip__panel-1-body m-background-tasks-chip__details">
              <span className="m-background-tasks-chip__heading">{label}</span>
              <ul data-slot="background-task-list" className="m-background-tasks-chip__list">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    data-slot="background-task-row"
                    data-task-id={task.id}
                    className="m-background-tasks-chip__row"
                  >
                    <div className="m-background-tasks-chip__description">
                      <span
                        data-slot="background-task-title"
                        className="m-background-tasks-chip__title"
                        title={task.description ?? task.command ?? undefined}
                      >
                        {task.description || task.command || task.id}
                      </span>
                      {task.description && task.command && (
                        <span className="m-background-tasks-chip__command">{task.command}</span>
                      )}
                    </div>
                    <span data-slot="background-task-elapsed" className="m-background-tasks-chip__elapsed">
                      {(() => {
                        const elapsed = elapsedLabel(now - task.started_at)
                        return t(elapsed.key, elapsed.values)
                      })()}
                    </span>
                    <TooltipTrigger>
                      <Button
                        icon={<FileText />}
                        size="sm"
                        variant="ghost"
                        aria-label={t('chat.background.output')}
                        onPress={() => setReading(task)}
                        className="m-background-tasks-chip__output"
                      />
                      <Tooltip>{t('chat.background.output')}</Tooltip>
                    </TooltipTrigger>
                    <TooltipTrigger>
                      <Button
                        icon={<Stop />}
                        size="sm"
                        variant="ghost"
                        aria-label={t('chat.background.stop')}
                        onPress={() => onStop(task.id)}
                        className="m-background-tasks-chip__stop"
                      />
                      <Tooltip>{t('chat.background.stop')}</Tooltip>
                    </TooltipTrigger>
                  </li>
                ))}
              </ul>
            </div>
          </PopoverDialog>
        </Popover>
      </DialogTrigger>
      {reading && (
        <BackgroundTaskOutputSheet conversationId={conversationId} task={reading} onClose={() => setReading(null)} />
      )}
    </>
  )
}

/** The most one read hands back; mirrors `background::READ_MAX`. */
const READ_MAX = 256 * 1024

/**
 * A task's output, following it while it runs.
 *
 * Polled rather than pushed: output is not an event, and one read a second
 * for the one task somebody is looking at is cheaper than a channel every task
 * would pay for. Shows the last 256 KiB; the whole log is the model's to read.
 */
function BackgroundTaskOutputSheet({
  conversationId,
  task,
  onClose,
}: {
  conversationId: string
  task: BackgroundTaskInfoResponse
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState(task)

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const load = async () => {
      try {
        let slice = await api.readBackgroundTaskOutput({ conversationId, id: task.id, offset: 0 })
        if (slice.total_bytes > READ_MAX) {
          slice = await api.readBackgroundTaskOutput({
            conversationId,
            id: task.id,
            offset: slice.total_bytes - READ_MAX,
          })
        }
        if (!alive) return
        setContent(slice.content)
        setCurrent(slice.task)
        setError(null)
        if (slice.task.state === 'running') timer = window.setTimeout(() => void load(), 1000)
      } catch (err) {
        if (alive) setError(errorMessage(err))
      }
    }
    void load()
    return () => {
      alive = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [conversationId, task.id])

  return (
    <Sheet isOpen placement="right" onOpenChange={(open) => !open && onClose()} isDismissable>
      <Sheet.Backdrop>
        <Sheet.Content className="w-full sm:max-w-2xl">
          <Sheet.Dialog className="flex h-full min-h-0 flex-col">
            <Sheet.Header className="pe-14">
              <Sheet.Heading className="truncate">{task.description || t('chat.background.outputTitle')}</Sheet.Heading>
              <p
                className="mt-1 truncate font-mono text-caption-1-regular text-text-secondary"
                title={task.command ?? ''}
              >
                {task.command}
              </p>
              <p data-slot="background-output-state" className="mt-1 text-caption-1-regular text-text-secondary">
                {t(`chat.background.state.${current.state}`)}
                {current.exit_code != null && ` · ${t('chat.background.exitCode', { code: current.exit_code })}`}
              </p>
              <Sheet.CloseTrigger aria-label={t('common.close')} />
            </Sheet.Header>
            <Sheet.Body data-sheet-no-drag className="min-h-0 flex-1 overflow-auto">
              {error ? (
                <ErrorAlert title={t('chat.background.readFailed')} message={error} />
              ) : content === null ? (
                <div role="status" className="flex items-center gap-2 text-body-regular text-text-secondary">
                  <span aria-hidden>
                    <Spinner size="sm" />
                  </span>
                  {t('chat.background.loading')}
                </div>
              ) : (
                <pre
                  data-slot="background-output"
                  className="font-mono text-caption-1-regular whitespace-pre-wrap break-all text-text-primary"
                >
                  {content || t('chat.background.empty')}
                </pre>
              )}
            </Sheet.Body>
          </Sheet.Dialog>
        </Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
  )
}
