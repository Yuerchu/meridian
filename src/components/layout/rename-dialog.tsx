import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Modal, TextField } from '@/components/base'

import { useHistoryLevel } from '@/hooks/use-history-level'

/**
 * Renaming, as a dialog rather than an edit in place.
 *
 * The sidebar edits inline and commits on blur, which is right with a mouse and
 * wrong with a keyboard that covers half the screen: on Android dismissing the
 * keyboard *is* a blur, so backing out halfway through would silently save a
 * half-typed title. Here the only ways out are Save and Cancel.
 *
 * **The keyboard has to be padded for by hand.** HeroUI sizes a modal with
 * `--visual-viewport-height`, which React Aria fills in from
 * `window.visualViewport` — and this app runs `adjustNothing`, so the WebView is
 * never resized and that variable never moves. The dialog opens focused, which
 * means the keyboard is up immediately and the footer was underneath it. The
 * inset is reported separately (`use-android-insets` writes `--ime-bottom` onto
 * `<html>`, which a portalled dialog can still read).
 */
export function RenameDialog({
  isOpen,
  onOpenChange,
  initialValue,
  heading,
  onSubmit,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  initialValue: string
  heading: string
  onSubmit: (value: string) => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initialValue)

  // A level of its own, like the palette and the sidebar sheet. Without it the
  // back gesture reached straight past this dialog to whatever was underneath —
  // closing the sheet behind the scrim, and then leaving the app on the next
  // press with the dialog still open.
  useHistoryLevel(isOpen, () => onOpenChange(false))

  // The dialog is one instance reused for every row, so the field has to be
  // refilled each time it opens rather than only on mount.
  useEffect(() => {
    if (isOpen) setValue(initialValue)
  }, [isOpen, initialValue])

  const trimmed = value.trim()
  const canSave = trimmed.length > 0 && trimmed !== initialValue

  const submit = () => {
    if (!canSave) return
    onSubmit(trimmed)
    onOpenChange(false)
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="center" size="sm" className="pb-[var(--ime-bottom,0px)]">
        <Modal.Dialog data-slot="rename-dialog">
          <Modal.Header>
            <Modal.Heading>{heading}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <TextField fullWidth aria-label={heading} autoFocus>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
            </TextField>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary">
              {t('common.cancel')}
            </Button>
            <Button onPress={submit} isDisabled={!canSave}>
              {t('common.save')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
