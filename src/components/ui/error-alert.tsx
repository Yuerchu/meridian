import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from '@keyline-icons/react/two-tone'

import { Alert, Button, Tooltip, TooltipTrigger } from '@/components/base'
import { cx } from '@/utils/cx'

interface ErrorAlertProps extends Omit<ComponentProps<'div'>, 'title' | 'role'> {
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
  /** Takes the notice away without changing anything else. */
  onDismiss?: () => void
  /** `alert` for a failure the reader just caused or is waiting on; `status`
   *  for one that is part of the record, which a screen reader should not
   *  interrupt for every time it scrolls past. */
  role?: 'alert' | 'status'
}

/**
 * A failure, where it happened, until somebody deals with it.
 *
 * The registry's `Alert` with the two actions a failure can offer. It holds no
 * state and sets no timer: it is on screen exactly as long as its owner keeps
 * the error, which is until a retry, a dismissal, or the state it describes
 * genuinely changing. A notice that clears itself is the "flash" — shown for a
 * frame and gone before anyone could read it.
 */
export function ErrorAlert({
  title,
  message,
  onRetry,
  retryLabel,
  retrying = false,
  onDismiss,
  role = 'alert',
  className,
  ...props
}: ErrorAlertProps) {
  const { t } = useTranslation()
  return (
    <Alert status="danger" role={role} data-slot="error-alert" className={cx('min-w-0', className)} {...props}>
      <Alert.Indicator />
      <Alert.Content className="min-w-0">
        {title && <Alert.Title>{title}</Alert.Title>}
        <Alert.Description data-slot="error-alert-message" className="break-words whitespace-pre-wrap">
          {message}
        </Alert.Description>
        {onRetry && (
          <Button size="small" variant="secondary" className="mt-2" isPending={retrying} onPress={onRetry}>
            {retryLabel ?? t('common.retry')}
          </Button>
        )}
      </Alert.Content>
      {onDismiss && (
        <TooltipTrigger delay={0}>
          <Button
            iconOnly
            leadingIcon={X}
            size="small"
            variant="neutral"
            aria-label={t('common.dismiss')}
            onPress={onDismiss}
            className="touch-hitbox shrink-0"
          />
          <Tooltip>{t('common.dismiss')}</Tooltip>
        </TooltipTrigger>
      )}
    </Alert>
  )
}
