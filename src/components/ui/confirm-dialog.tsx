import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, Button, Sheet } from '@/components/base'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useIsMobile } from '@/hooks/use-mobile'

export interface ConfirmOptions {
  /** Defaults to `confirm.title`. */
  title?: ReactNode
  body: ReactNode
  /** Defaults to `common.confirm`. */
  confirmLabel?: ReactNode
  /** Destructive unless said otherwise: everything that asks here is a delete. */
  status?: 'danger' | 'warning' | 'accent'
  /**
   * `auto` rises from the bottom edge on a phone and sits in the middle of the
   * screen everywhere else. `center` is always centred, and is what a sheet
   * asking about its own unsaved work uses: the question has to read as a
   * different surface from the thing it is about, and a second panel sliding
   * up over the first — handle and all — leaves the gesture ambiguous.
   */
  presentation?: 'auto' | 'center'
}

/**
 * "Are you sure?", once.
 *
 * There were five of these written out by hand, identical down to the
 * `aria-describedby` workaround — the body is a plain div, so without an id
 * wired to it the dialog announces its title and then nothing. That is baked in
 * here, along with the status icon none of the five had.
 *
 * Escape, the scrim, the back gesture and Cancel all answer **no**; only the
 * confirming button answers yes. (An earlier note here claimed Escape and the
 * scrim did not dismiss it at all. They always have: `AlertDialog.Backdrop`
 * defaults to `isDismissable` and never sets `isKeyboardDismissDisabled`. The
 * behaviour was right and the explanation was not.)
 */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  title,
  body,
  confirmLabel,
  status = 'danger',
  presentation = 'auto',
}: ConfirmOptions & {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const descId = useId()
  const isMobile = useIsMobile()
  const asSheet = presentation === 'auto' && isMobile

  // Claimed here rather than in `useConfirm`, because the two presentations
  // have to end up with one level between them and only this component knows
  // which one is on screen.
  useHistoryLevel(isOpen, () => onOpenChange(false))

  const heading = title ?? t('confirm.title')
  const buttons = (
    <>
      <Button slot="close" variant="tertiary">
        {t('common.cancel')}
      </Button>
      {/* Closed here rather than with `slot="close"`, so that the answer
          is recorded before the dialog goes: `useConfirm` settles its
          promise from `onOpenChange`, and a close it did not order means
          no. */}
      <Button
        variant={status === 'danger' ? 'danger' : 'primary'}
        onPress={() => {
          onConfirm()
          onOpenChange(false)
        }}
      >
        {confirmLabel ?? t('common.confirm')}
      </Button>
    </>
  )

  if (asSheet) {
    return (
      <Sheet isOpen={isOpen} onOpenChange={onOpenChange} placement="bottom">
        <Sheet.Backdrop>
          <Sheet.Content>
            {/* `alertdialog`, as the centred form is: what this is does not
                change with where it appears. */}
            <Sheet.Dialog
              role="alertdialog"
              aria-describedby={descId}
              data-slot="confirm-sheet"
              className="pb-[max(1rem,var(--safe-bottom))]"
            >
              <Sheet.Handle />
              <Sheet.Header className="flex-row items-center gap-3">
                <AlertDialog.Icon status={status} />
                <Sheet.Heading>{heading}</Sheet.Heading>
              </Sheet.Header>
              <Sheet.Body id={descId} className="text-body-regular text-text-secondary">
                {body}
              </Sheet.Body>
              <Sheet.Footer>{buttons}</Sheet.Footer>
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
    )
  }

  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog aria-describedby={descId}>
          <AlertDialog.Header>
            <AlertDialog.Icon status={status} />
            <AlertDialog.Heading>{heading}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body id={descId}>{body}</AlertDialog.Body>
          <AlertDialog.Footer>{buttons}</AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
