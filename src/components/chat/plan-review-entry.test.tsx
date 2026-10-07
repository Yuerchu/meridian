import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { api } from '@/api'
import { ChatToolPresentationProvider } from '@/components/ui/chat-tool'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { PlanReviewInfoResponse, PlanReviewStatus, ToolCallDisplay } from '@/types'
import { PlanReviewEntryBlock } from './plan-review-entry'

vi.mock('@/api', () => ({
  api: {
    getPlanReview: vi.fn(),
    savePlanReviewDraft: vi.fn(),
    decidePlanReview: vi.fn(),
  },
}))

const getPlanReview = vi.mocked(api.getPlanReview)
const decide = vi.mocked(api.decidePlanReview)

const PLAN = '# Fix the scroller\n\n1. Track reader scroll\n2. Change the pin check\n'

function info(note: string | null = null): PlanReviewInfoResponse {
  return {
    document: {
      id: 'document-1',
      conversation_id: 'conversation-1',
      state: 'reviewing',
      head_revision_id: 'revision-1',
      approved_revision_id: null,
      working_generation: 0,
      file_rel_path: '.meridian/plans/plan.md',
      file_sync_state: 'applied',
      created_at: 1,
      updated_at: 1,
    },
    review: {
      id: 'review-1',
      document_id: 'document-1',
      submitted_revision_id: 'revision-1',
      state: 'pending',
      decision_id: null,
      suggestion_revision_id: null,
      assistant_message_id: 'message-1',
      provider_call_id: 'call-1',
      turn_id: 'turn-1',
      lock_version: 0,
      created_at: 1,
      updated_at: 1,
    },
    submitted_revision: {
      id: 'revision-1',
      document_id: 'document-1',
      revision_no: 2,
      parent_revision_id: null,
      author_kind: 'assistant',
      content_markdown: PLAN,
      content_sha256: 'revision-hash',
      patch: null,
      responding_to_suggestion_revision_id: null,
      assistant_message_id: 'message-1',
      provider_call_id: 'call-1',
      editor_json: null,
      created_at: 1,
    },
    parent_revision: null,
    draft: {
      review_id: 'review-1',
      base_revision_id: 'revision-1',
      generation: 3,
      mode: 'source',
      base_editor_json: null,
      draft_editor_json: null,
      source_text: PLAN,
      base_normalized_markdown: PLAN,
      draft_normalized_markdown: PLAN,
      draft_sha256: 'draft-hash',
      global_note: note,
      selection: null,
      editor_schema_version: null,
      editor_schema_hash: null,
      created_at: 1,
      updated_at: 1,
    },
    comments: [],
    delivery: null,
  }
}

const DATA: ToolCallDisplay = {
  call_id: 'call-1',
  tool_name: 'exit_plan',
  arguments: '{}',
  status: 'pending',
  plan_review_id: 'review-1',
}

function remember(status: PlanReviewStatus) {
  usePlanReviewStore.setState({
    activeReviewId: null,
    summaries: {
      'review-1': {
        review_id: 'review-1',
        conversation_id: 'conversation-1',
        document_id: 'document-1',
        revision_id: 'revision-1',
        assistant_message_id: 'message-1',
        provider_call_id: 'call-1',
        turn_id: 'turn-1',
        status,
        delivery_state: null,
        lock_version: 0,
      },
    },
  })
}

function inBubble() {
  return render(
    <ChatToolPresentationProvider value="bubble">
      <PlanReviewEntryBlock data={DATA} reviewId="review-1" />
    </ChatToolPresentationProvider>,
  )
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  vi.clearAllMocks()
  getPlanReview.mockResolvedValue(info())
  decide.mockResolvedValue({
    review_id: 'review-1',
    state: 'approved',
    delivery_state: 'queued',
    continuation_turn_id: 't',
  })
})

describe('PlanReviewEntryBlock', () => {
  it('names the revision and opens with the plan’s first lines', async () => {
    remember('pending')
    inBubble()
    expect(await screen.findByText('Revision 2')).toBeInTheDocument()
    expect(screen.getByText('Fix the scroller')).toBeInTheDocument()
    expect(screen.getByText('1. Track reader scroll')).toBeInTheDocument()
  })

  it('opens the review page from the excerpt', async () => {
    remember('pending')
    inBubble()
    await userEvent.click(await screen.findByRole('button', { name: /Fix the scroller/ }))
    expect(usePlanReviewStore.getState().activeReviewId).toBe('review-1')
  })

  it('approves from the card through the review decision', async () => {
    remember('pending')
    inBubble()
    await userEvent.click(screen.getByRole('button', { name: 'Approve and start' }))
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 'review-1', action: 'approve' })),
    )
  })

  /** The draft holds the reviewer's own note: the card hands over to the page
   *  instead of deciding past it, and stops offering the two decisions. */
  it('hands an unfinished draft back to the review page', async () => {
    remember('pending')
    getPlanReview.mockResolvedValue(info('Half a thought'))
    inBubble()
    await userEvent.click(screen.getByRole('button', { name: 'Approve and start' }))
    expect(await screen.findByText(i18n.t('chat.plan.draftInProgress'))).toBeInTheDocument()
    expect(decide).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Approve and start' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Review plan' })).toBeInTheDocument()
  })

  it('shows a failed decision where it was asked for', async () => {
    remember('pending')
    decide.mockRejectedValue('plan state conflict: expected draft generation 3, found 4')
    inBubble()
    await userEvent.click(screen.getByRole('button', { name: 'Approve and start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('expected draft generation 3')
  })

  it('sends a note back from the card', async () => {
    remember('pending')
    vi.mocked(api.savePlanReviewDraft).mockResolvedValue({
      review_id: 'review-1',
      generation: 4,
      draft_sha256: 'draft-hash-4',
      updated_at: 2,
    })
    inBubble()
    await userEvent.click(screen.getByRole('button', { name: 'Send back' }))
    await userEvent.type(screen.getByRole('textbox', { name: i18n.t('chat.plan.feedbackLabel') }), 'Add tests')
    await userEvent.click(screen.getByRole('button', { name: 'Submit feedback' }))
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'request_changes',
          expectedGeneration: 4,
          expectedDraftHash: 'draft-hash-4',
        }),
      ),
    )
  })

  /** Settled, it is history: a key to the page, with no decision left on it. */
  it('goes back to being a key once decided', async () => {
    remember('approved')
    const { container } = inBubble()
    const key = container.querySelector<HTMLElement>('[data-slot="plan-review-entry"]')!
    expect(key.tagName).toBe('BUTTON')
    expect(await within(key).findByText('Revision 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and start' })).toBeNull()
    await userEvent.click(key)
    expect(usePlanReviewStore.getState().activeReviewId).toBe('review-1')
  })
})
