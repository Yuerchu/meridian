import { useTranslation } from 'react-i18next'
import { Check, Copy, TriangleAlert } from '@keyline-icons/react/two-tone'

import { useCopy } from '@/hooks/use-copy'
import { ActionButton } from './action-button'

/**
 * What a copy came to, for a screen reader: a status region beside the button.
 *
 * An icon-only button has no text of its own for a reader to notice changing,
 * and a label swapped under focus is announced by some readers and not others.
 * Visible feedback is the caller's — a tick, a warning, a line of text — because
 * where it fits differs at every site; this part does not.
 */
export function CopyAnnouncement({ copied, failure }: { copied: boolean; failure: string | null }) {
  const { t } = useTranslation()
  return (
    <span role="status" className="sr-only">
      {failure !== null ? t('common.copyFailed', { error: failure }) : copied ? t('common.copied') : ''}
    </span>
  )
}

/**
 * The icon button that copies a message, a code block or a command's output.
 * The icon and the tooltip say what happened; a refused copy keeps its
 * warning, with the reason, until the next press.
 */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation()
  const { copied, failure, copy } = useCopy()

  return (
    <>
      <ActionButton
        label={
          failure !== null ? t('common.copyFailed', { error: failure }) : copied ? t('common.copied') : t('chat.copy')
        }
        onClick={() => void copy(text)}
        className={className}
        icon={failure !== null ? TriangleAlert : copied ? Check : Copy}
      />
      <CopyAnnouncement copied={copied} failure={failure} />
    </>
  )
}
