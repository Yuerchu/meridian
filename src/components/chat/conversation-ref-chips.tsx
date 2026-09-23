import { useTranslation } from 'react-i18next'
import { Chip } from '@/components/base'
import { Messages } from '@keyline-icons/react/two-tone'

import { cx } from '@/utils/cx'
import type { MessageContextInfoResponse } from '@/types'

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
    <div data-slot="conversation-ref-chips" className={cx('flex min-w-0 flex-wrap gap-1', className)}>
      {refs.map((ref) => (
        <Chip key={ref.id} size="sm" variant="soft" aria-label={t('chat.convRef.chip', { name: ref.display_path })}>
          <Messages className="size-3" aria-hidden />
          <span data-slot="conversation-ref-chip-label" className="max-w-48 truncate">
            {ref.display_path}
          </span>
        </Chip>
      ))}
    </div>
  )
}
