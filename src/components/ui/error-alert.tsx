import { useTranslation } from 'react-i18next'

import { Alert, type AlertProps } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import './error-alert.css'

interface ErrorAlertProps extends Omit<AlertProps, 'heading' | 'children' | 'tone' | 'actions' | 'shouldAnnounce'> {
  /** What was being attempted, when the reason alone does not say it. */
  title?: string
  /** The reason, as the backend put it. Never replaced by a generic sentence:
   *  the backend's message is already written for a person, and "something
   *  went wrong" is what sent the reader off to the log file. */
  message: string
  /** Offered only where doing it again can succeed — a read, a reload. */
  onRetry?: () => void
  retryLabel?: string
  retrying?: boolean
  /** `alert` for a failure the reader just caused or is waiting on; `status`
   *  for one that is part of the record, which a screen reader should not
   *  interrupt for every time it scrolls past — the transcript mounts turns as
   *  they come near (`LazyTurn`), so an `alert` there would interrupt on every
   *  scroll. */
  role?: 'alert' | 'status'
}

/**
 * A failure, where it happened, until somebody deals with it.
 *
 * The library's `Alert` with the two actions a failure can offer. It holds no
 * state and sets no timer: it is on screen exactly as long as its owner keeps
 * the error, which is until a retry, a dismissal (`onDismiss`), or the state it
 * describes genuinely changing. A notice that clears itself is the "flash" —
 * shown for a frame and gone before anyone could read it.
 *
 * The library announces a danger alert assertively or not at all, so the
 * polite `status` is a live region around it rather than a prop on it.
 */
export function ErrorAlert({
  title,
  message,
  onRetry,
  retryLabel,
  retrying = false,
  role = 'alert',
  className,
  ...props
}: ErrorAlertProps) {
  const { t } = useTranslation()
  const alert = (
    <Alert
      tone="danger"
      heading={title}
      shouldAnnounce={role === 'alert'}
      data-slot="error-alert"
      className={className ? `m-error-alert ${className}` : 'm-error-alert'}
      actions={
        onRetry && (
          <Button size="sm" variant="secondary" isPending={retrying} onPress={onRetry}>
            {retryLabel ?? t('common.retry')}
          </Button>
        )
      }
      {...props}
    >
      <span data-slot="error-alert-message" className="m-error-alert__message">
        {message}
      </span>
    </Alert>
  )
  return role === 'status' ? <div role="status">{alert}</div> : alert
}
