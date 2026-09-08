import { useTranslation } from 'react-i18next'
import { Chip } from '@heroui/react'
import { Comments } from '@gravity-ui/icons'

import type { MessageContextInfoResponse } from '@/types'

/**
 * The conversations a message carried as frozen context, drawn from the
 * descriptors — the first consumer of `context_items` in the transcript.
 * `display_path` holds the referenced thread's title; the id deliberately
 * stays behind the IPC boundary, so the chip names the thread without
 * navigating to it.
 */
export function ConversationRefChips({ items }: { items: MessageContextInfoResponse[] }) {
  const { t } = useTranslation()
  const refs = items.filter((item) => item.kind === 'conversation')
  if (refs.length === 0) return null
  return (
    <div data-slot="conversation-ref-chips" className="flex max-w-[80%] flex-wrap justify-end gap-1">
      {refs.map((ref) => (
        <Chip key={ref.id} size="sm" variant="soft" aria-label={t('chat.convRef.chip', { name: ref.display_path })}>
          <Comments className="size-3" aria-hidden />
          <span data-slot="conversation-ref-chip-label" className="max-w-48 truncate">
            {ref.display_path}
          </span>
        </Chip>
      ))}
    </div>
  )
}
