// A question waiting on a person, answered on a collapsed card.
//
// The notification stack's rule, not a looser one: `attentionShape` decides
// whether Allow / Deny may be offered here — a read-only call drawn whole —
// and everything else shows why not and offers to open the card, where the
// real approval block is. The summary, the labels, the button looks and what
// pressing them does are the stack's own (`AttentionSummary`,
// `attentionActionLabel`, `ACTION_VARIANT`, `useAttentionActions`); "later"
// has no place on a board and "view" opens the card in place instead of
// navigating away.
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/base'
import { AttentionSummary } from '@/components/layout/approval-notifications'
import {
  ACTION_VARIANT,
  attentionActionIds,
  attentionActionLabel,
  attentionShape,
  useAttentionActions,
} from '@/components/layout/approval-queue'
import type { AttentionItem } from '@/stores/conversation-store'

/** The board never navigates from a decision: "view" is opening the card. */
async function stayOnTheBoard(): Promise<boolean> {
  return false
}

export function InlineDecision({ item, onOpen }: { item: AttentionItem; onOpen: () => void }) {
  const { t } = useTranslation()
  const shape = attentionShape(item)
  const act = useAttentionActions(stayOnTheBoard)
  const decisions = attentionActionIds(shape).filter((id) => id === 'deny' || id === 'allow')

  return (
    <div
      data-slot="board-inline-decision"
      className="flex flex-col gap-2 rounded-xl bg-background-secondary-default p-2.5 text-caption-1-regular"
    >
      <span className="flex min-w-0 flex-col">
        <AttentionSummary item={item} shape={shape} />
      </span>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="small" variant="secondary" onPress={onOpen}>
          {t('board.card.details')}
        </Button>
        {decisions.map((id) => (
          <Button key={id} size="small" variant={ACTION_VARIANT[id]} onPress={() => act(item, id)}>
            {attentionActionLabel(t, item, id)}
          </Button>
        ))}
      </div>
    </div>
  )
}
