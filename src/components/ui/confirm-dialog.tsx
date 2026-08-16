import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, Button } from '@heroui/react'

export interface ConfirmOptions {
  /** Defaults to `confirm.title`. */
  title?: ReactNode
  body: ReactNode
  /** Defaults to `common.confirm`. */
  confirmLabel?: ReactNode
  /** Destructive unless said otherwise: everything that asks here is a delete. */
  status?: 'danger' | 'warning' | 'accent'
}

/**
 * "Are you sure?", once.
 *
 * There were five of these written out by hand, identical down to the
 * `aria-describedby` workaround — `AlertDialog.Body` is a plain div, so without
 * an id wired to it the dialog announces its title and then nothing. That is
 * baked in here, along with the status icon none of the five had.
 *
 * Neither ESC nor a click on the backdrop dismisses it. That is HeroUI's
 * default for an alert dialog rather than a decision taken here, and it is the
 * right one: an accidental Escape should not read as consent.
 */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  title,
  body,
  confirmLabel,
  status = 'danger',
}: ConfirmOptions & {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const descId = useId()

  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog aria-describedby={descId}>
          <AlertDialog.Header>
            <AlertDialog.Icon status={status} />
            <AlertDialog.Heading>{title ?? t('confirm.title')}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body id={descId}>{body}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">
              {t('common.cancel')}
            </Button>
            {/* Closed here rather than with `slot="close"`, so that the answer
                is recorded before the dialog goes: `useConfirm` settles its
                promise from `onOpenChange`, and a close it did not order means
                no. */}
            <Button
              variant={status === 'danger' ? 'danger' : 'primary'}
              onClick={() => { onConfirm(); onOpenChange(false) }}
            >
              {confirmLabel ?? t('common.confirm')}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
