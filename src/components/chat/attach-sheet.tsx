import { useState, useCallback, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu as AriaMenu } from 'react-aria-components'
import { Camera, FaceSmile, Image, Paperclip, Plus } from '@keyline-icons/react/two-tone'
import { Button, DropdownItem, Sheet, Tooltip, TooltipTrigger } from '@/components/base'
import { MENU_ITEMS_CONTAINER } from '@/components/base/dropdown/menu-styles'
import { cx } from '@/utils/cx'

export interface AttachSheetProps {
  onTakePhoto: () => void
  onPickGallery: () => void
  /** Absent hides the entry, the way `ComposerMenu` already treats it. */
  onPickFile?: () => void
  supportsImages: boolean
  /** Opens the sticker picker, which anchors itself to `triggerRef`. Absent hides the row. */
  onOpenStickers?: () => void
  /** The sheet's `+`, for what has to be drawn beside it once the sheet is gone. */
  triggerRef?: Ref<HTMLButtonElement>
}

/**
 * The phone's `+`: a bottom sheet of what can be added to the message — a
 * photo, a picture from the gallery, a file, a sticker.
 *
 * It used to carry the model, the effort, the assistant, the mode and two
 * toggles as well, in panels; those are the mode chip and the model panel on
 * the toolbar now, on a phone as on a desktop. A sheet is still the right
 * shape for what is left: four actions a thumb reaches, rather than a popover
 * from a 36px button.
 *
 * With nothing to add there is no sheet.
 */
export function AttachSheet({
  onTakePhoto,
  onPickGallery,
  onPickFile,
  supportsImages,
  onOpenStickers,
  triggerRef,
}: AttachSheetProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleAction = useCallback((action: () => void) => {
    setOpen(false)
    action()
  }, [])

  if (!supportsImages && !onPickFile && !onOpenStickers) return null

  return (
    <Sheet isOpen={open} placement="bottom" onOpenChange={setOpen}>
      <TooltipTrigger delay={0}>
        <Button
          ref={triggerRef}
          variant="neutral"
          iconOnly
          leadingIcon={Plus}
          size="small"
          aria-label={t('composer.menu')}
          onPress={() => setOpen(true)}
          className="touch-hitbox"
        />
        <Tooltip>{t('composer.menu')}</Tooltip>
      </TooltipTrigger>
      <Sheet.Backdrop>
        <Sheet.Content>
          <Sheet.Dialog
            aria-label={t('composer.menu')}
            // `--safe-bottom`, not bare `env()`: Android WebView reports zero
            // for the latter (crbug 40699457, only fixed in M144), which is the
            // whole reason the native bridge writes these variables. With
            // 3-button navigation that bar is 48dp of opaque buttons, so the
            // last row here was landing under it and could not be tapped.
            // No top padding of its own: `Sheet.Handle` is a 24px hit target
            // now rather than a 4px pill, and supplies the breathing room.
            className="max-h-[70vh] px-0 pb-[max(1rem,var(--safe-bottom))]"
          >
            <Sheet.Handle />
            <Sheet.Body className="text-text-primary">
              {/* A React Aria `Menu` of the registry's dropdown rows. */}
              <AriaMenu
                data-slot="attach-sheet-menu"
                aria-label={t('composer.menu')}
                className={cx(MENU_ITEMS_CONTAINER, 'px-2.5')}
              >
                {supportsImages ? (
                  <DropdownItem id="photo" textValue={t('chat.takePhoto')} onAction={() => handleAction(onTakePhoto)}>
                    <Camera aria-hidden className="size-4 shrink-0 text-text-secondary" />
                    <span data-slot="attach-sheet-label">{t('chat.takePhoto')}</span>
                  </DropdownItem>
                ) : null}
                {supportsImages ? (
                  <DropdownItem
                    id="gallery"
                    textValue={t('chat.pickFromGallery')}
                    onAction={() => handleAction(onPickGallery)}
                  >
                    <Image aria-hidden className="size-4 shrink-0 text-text-secondary" />
                    <span data-slot="attach-sheet-label">{t('chat.pickFromGallery')}</span>
                  </DropdownItem>
                ) : null}
                {onPickFile ? (
                  <DropdownItem id="file" textValue={t('chat.attachFile')} onAction={() => handleAction(onPickFile)}>
                    <Paperclip aria-hidden className="size-4 shrink-0 text-text-secondary" />
                    <span data-slot="attach-sheet-label">{t('chat.attachFile')}</span>
                  </DropdownItem>
                ) : null}
                {onOpenStickers ? (
                  <DropdownItem id="stickers" textValue={t('chat.emoji')} onAction={() => handleAction(onOpenStickers)}>
                    <FaceSmile aria-hidden className="size-4 shrink-0 text-text-secondary" />
                    <span data-slot="attach-sheet-label">{t('chat.emoji')}</span>
                  </DropdownItem>
                ) : null}
              </AriaMenu>
            </Sheet.Body>
          </Sheet.Dialog>
        </Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
  )
}
