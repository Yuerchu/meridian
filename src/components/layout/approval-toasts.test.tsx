import { act, render, screen } from '@testing-library/react'

import i18n from '@/i18n'
import { useConversationStore, type AttentionItem } from '@/stores/conversation-store'
import type { ConversationInfoResponse } from '@/types'
import { ApprovalToastRegion } from './approval-toasts'

function reviewAttention(stage: Extract<AttentionItem, { kind: 'plan_review' }>['stage']): AttentionItem {
  return {
    approvalId: 'review-1',
    reviewId: 'review-1',
    conversationId: 'conversation-1',
    documentId: 'document-1',
    revisionId: 'revision-1',
    turnId: 'turn-1',
    stage,
    kind: 'plan_review',
  }
}

describe('plan review attention toast', () => {
  beforeEach(() => {
    useConversationStore.setState({
      conversations: [{ id: 'conversation-1', title: 'Plan conversation' } as ConversationInfoResponse],
      activeId: null,
      attention: { 'review-1': reviewAttention('delivery_queued') },
      attentionOrder: ['review-1'],
    })
  })

  it('replaces queued copy with the localized recovery prompt when delivery needs attention', async () => {
    render(<ApprovalToastRegion onSelect={() => {}} />)
    expect(await screen.findByText(i18n.t('planReview.deliveryQueued'))).toBeVisible()

    act(() => {
      useConversationStore.setState({ attention: { 'review-1': reviewAttention('delivery_attention') } })
    })

    expect(await screen.findByText(i18n.t('chat.plan.continuationNeedsAttention'))).toBeVisible()
    expect(screen.queryByText(i18n.t('planReview.deliveryQueued'))).toBeNull()
  })
})
