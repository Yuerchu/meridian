import './conversation-ref-chips.css'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Messages } from '@keyline-icons/react/two-tone'

import type { MessageContextInfoResponse } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

/**
 * The conversations a message carried as frozen context, drawn from the
 * descriptors — the first consumer of `context_items` in the transcript.
 * `display_path` holds the referenced thread's title; the id deliberately
 * stays behind the IPC boundary, so the chip names the thread without
 * navigating to it.
 */
export function ConversationRefChips({
  items,
  className,
}: {
  items: MessageContextInfoResponse[]
  className?: string
}) {
  const { t } = useTranslation()
  const refs = items.filter((item) => item.kind === 'conversation')
  if (refs.length === 0) return null
  return (
    <div
      data-slot="conversation-ref-chips"
      className={['m-conversation-ref-chips', className].filter(Boolean).join(' ')}
    >
      {refs.map((ref) => (
        <Badge key={ref.id} size="sm" aria-label={t('chat.convRef.chip', { name: ref.display_path })}>
          <Messages className="m-conversation-ref-chips__icon" aria-hidden />
          <span
            data-slot="conversation-ref-chip-label"
            onPointerEnter={titleIfTruncated}
            className="m-conversation-ref-chips__label"
          >
            {ref.display_path}
          </span>
        </Badge>
      ))}
    </div>
  )
}
