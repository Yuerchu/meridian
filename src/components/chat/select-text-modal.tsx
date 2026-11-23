import './select-text-modal.css'
import { useTranslation } from 'react-i18next'
import { Check } from '@keyline-icons/react/two-tone'
import { Dialog, DialogFooter } from '@/components/yuerchu-ui/components/dialog/dialog'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { CopyAnnouncement } from '@/components/ui/copy-button'
import { useCopy } from '@/hooks/use-copy'

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
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      heading={t('contextMenu.selectText')}
      description={t('contextMenu.selectTextHint')}
      size="full"
      className="m-select-text-modal"
    >
      {/* Keyed by the text: one dialog serves every bubble of a group, and
          without it a "Copied" — or a refusal — from the last bubble was
          still showing for the next, whose text was not on the clipboard. */}
      <SelectTextBody key={text} text={text} />
    </Dialog>
  )
}

function SelectTextBody({ text }: { text: string }) {
  const { t } = useTranslation()
  const { copied, failure, copy } = useCopy()

  return (
    <>
      <p data-slot="select-text-body" className="m-select-text-modal__text">
        {text}
      </p>
      {failure !== null && (
        <p data-slot="select-text-copy-error" role="alert" className="m-select-text-modal__error">
          {t('common.copyFailed', { error: failure })}
        </p>
      )}
      <DialogFooter>
        <Button slot="close" variant="secondary">
          {t('common.cancel')}
        </Button>
        <Button icon={copied ? <Check /> : undefined} onPress={() => void copy(text)}>
          {t(copied ? 'common.copied' : 'contextMenu.copyAll')}
        </Button>
        <CopyAnnouncement copied={copied} failure={null} />
      </DialogFooter>
    </>
  )
}
