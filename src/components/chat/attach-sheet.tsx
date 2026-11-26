import './attach-sheet.css'
import { useState, useCallback, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, FaceSmile, Image, Paperclip, Plus } from '@keyline-icons/react/two-tone'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Drawer } from '@/components/yuerchu-ui/components/drawer/drawer'
import { Menu, MenuItem } from '@/components/yuerchu-ui/components/menu/menu'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { useHistoryLevel } from '@/hooks/use-history-level'

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
  useHistoryLevel(open, () => setOpen(false))

  const handleAction = useCallback((action: () => void) => {
    setOpen(false)
    action()
  }, [])

  if (!supportsImages && !onPickFile && !onOpenStickers) return null

  return (
    <>
      <TooltipTrigger>
        <Button
          ref={triggerRef}
          variant="ghost"
          icon={<Plus />}
          size="sm"
          aria-label={t('composer.menu')}
          onPress={() => setOpen(true)}
          className="m-attach-sheet__trigger"
        />
        <Tooltip>{t('composer.menu')}</Tooltip>
      </TooltipTrigger>
      <Drawer isOpen={open} onOpenChange={setOpen} side="bottom" size="lg" heading={t('composer.menu')}>
        {/* `Drawer` already clears `--ui-safe-bottom` (bridged to Android's native
            insets in `meridian.css`), so the body only adds its own visual gap. */}
        <div className="m-attach-sheet__body">
          <Menu variant="inline" data-slot="attach-sheet-menu" aria-label={t('composer.menu')}>
            {supportsImages ? (
              <MenuItem
                id="photo"
                icon={<Camera aria-hidden />}
                textValue={t('chat.takePhoto')}
                onAction={() => handleAction(onTakePhoto)}
              >
                <span data-slot="attach-sheet-label">{t('chat.takePhoto')}</span>
              </MenuItem>
            ) : null}
            {supportsImages ? (
              <MenuItem
                id="gallery"
                icon={<Image aria-hidden />}
                textValue={t('chat.pickFromGallery')}
                onAction={() => handleAction(onPickGallery)}
              >
                <span data-slot="attach-sheet-label">{t('chat.pickFromGallery')}</span>
              </MenuItem>
            ) : null}
            {onPickFile ? (
              <MenuItem
                id="file"
                icon={<Paperclip aria-hidden />}
                textValue={t('chat.attachFile')}
                onAction={() => handleAction(onPickFile)}
              >
                <span data-slot="attach-sheet-label">{t('chat.attachFile')}</span>
              </MenuItem>
            ) : null}
            {onOpenStickers ? (
              <MenuItem
                id="stickers"
                icon={<FaceSmile aria-hidden />}
                textValue={t('chat.emoji')}
                onAction={() => handleAction(onOpenStickers)}
              >
                <span data-slot="attach-sheet-label">{t('chat.emoji')}</span>
              </MenuItem>
            ) : null}
          </Menu>
        </div>
      </Drawer>
    </>
  )
}
