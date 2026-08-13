import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Modal, TextField } from '@heroui/react'

/**
 * Renaming, as a dialog rather than an edit in place.
 *
 * The sidebar edits inline and commits on blur, which is right with a mouse and
 * wrong with a keyboard that covers half the screen: on Android dismissing the
 * keyboard *is* a blur, so backing out halfway through would silently save a
 * half-typed title. Here the only ways out are Save and Cancel.
 *
 * A Modal also sizes itself against the visual viewport, so the field stays
 * above the keyboard wherever the row happened to be in the list.
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
      <Modal.Container placement="center">
        <Modal.Dialog data-slot="rename-dialog" className="sm:max-w-[360px]">
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
            <Button slot="close" variant="secondary">{t('common.cancel')}</Button>
            <Button onClick={submit} isDisabled={!canSave}>{t('common.save')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
