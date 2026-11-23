import './rename-dialog.css'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Dialog, DialogFooter } from '@/components/yuerchu-ui/components/dialog/dialog'
import { Button } from '@/components/yuerchu-ui/components/button/button'

import { useHistoryLevel } from '@/hooks/use-history-level'

/**
 * Renaming, as a dialog rather than an edit in place.
 *
 * The sidebar edits inline and commits on blur, which is right with a mouse and
 * wrong with a keyboard that covers half the screen: on Android dismissing the
 * keyboard *is* a blur, so backing out halfway through would silently save a
 * half-typed title. Here the only ways out are Save and Cancel.
 *
 * **The keyboard has to be padded for by hand.** Modal sizes itself with
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
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      heading={heading}
      size="sm"
      // The keyboard has to be padded for by hand (see above).
      className="m-rename-dialog"
    >
      <TextField
        aria-label={heading}
        autoFocus
        value={value}
        onChange={setValue}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      />

      <DialogFooter>
        <Button slot="close" variant="secondary">
          {t('common.cancel')}
        </Button>
        <Button onPress={submit} isDisabled={!canSave}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
