import { useTranslation } from 'react-i18next'
import { Spinner } from '@heroui/react'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'

/**
 * The two rows that sit under the last turn: a compaction in progress, and the
 * error the turn that just failed left behind.
 */
export function TranscriptStatus({ compacting, error }: { compacting: boolean; error: string | null }) {
  const { t } = useTranslation()

  return (
    <>
      {compacting && (
        <MessageScrollerItem messageId="__compacting">
          <Marker role="status" className="justify-center py-3">
            <MarkerIcon>
              {/* `sm` is 16px, the size of the icon slot. Left at its default
                  the spinner is 24px and overflows the row. */}
              <Spinner size="sm" />
            </MarkerIcon>
            <MarkerContent className="shimmer text-xs">{t('chat.compact.inProgress')}</MarkerContent>
          </Marker>
        </MessageScrollerItem>
      )}
      {/* After the turns, not before them: the error belongs to the turn that
          just failed, and the user is already at the bottom when it arrives.
          Deliberately not a scrollAnchor — an anchor aligns its item to the
          top of the viewport, which is what put the error out of sight in the
          first place. */}
      {error && (
        <MessageScrollerItem messageId="__error">
          <Bubble variant="destructive">
            <BubbleContent className="break-all">{error}</BubbleContent>
          </Bubble>
        </MessageScrollerItem>
      )}
    </>
  )
}
