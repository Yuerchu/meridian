import { useTranslation } from 'react-i18next'
import { Button, Modal } from '@/components/base'

/**
 * Somewhere to select part of a message with a finger.
 *
 * A touch screen has one long press and two things wanting it: the platform's
 * selection handles and our own context menu. Letting both answer puts the menu
 * on top of the handles, so the transcript turns selection off under a coarse
 * pointer (`pointer-coarse:select-none` on the message) and offers this instead
 * — a surface with nothing else listening, where the handles are the only thing
 * a long press can reach.
 *
 * The text is the message as it was written, not as it was rendered: on a phone
 * this is opened to lift a command or a path back out of an answer, and copying
 * rendered rich text would carry styling into the clipboard along with it.
 */
export function SelectTextModal({
  text,
  isOpen,
  onOpenChange,
}: {
  text: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="cover" placement="center">
        {/* Portalled to the body, so no ancestor's inset reaches it: HeroUI's
            own padding is all that stands between the footer buttons and the
            navigation bar, and under 3-button navigation that is not enough. */}
        <Modal.Dialog
          data-slot="select-text-dialog"
          className="pb-[max(1.5rem,var(--safe-bottom))] pl-[max(1.5rem,var(--safe-left))] pr-[max(1.5rem,var(--safe-right))]"
        >
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('contextMenu.selectText')}</Modal.Heading>
            <p data-slot="select-text-hint" className="mt-1.5 text-sm text-muted">
              {t('contextMenu.selectTextHint')}
            </p>
          </Modal.Header>
          <Modal.Body>
            {/* `select-text` explicitly: the dialog is portalled out of the
                message, but the transcript is not the only ancestor that turns
                selection off, and this is the one place that must have it. */}
            <p
              data-slot="select-text-body"
              className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word select-text"
            >
              {text}
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary">
              {t('common.cancel')}
            </Button>
            <Button onClick={() => navigator.clipboard.writeText(text)}>{t('contextMenu.copyAll')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
