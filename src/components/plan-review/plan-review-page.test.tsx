import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { PlanReviewInfoResponse, PlanRevisionInfoResponse } from '@/types'
import { PlanReviewPage } from './plan-review-page'

const mocks = vi.hoisted(() => ({
  getPlanReview: vi.fn(),
  listPlanRevisions: vi.fn(),
  savePlanReviewDraft: vi.fn(),
  continuePlanReviewDelivery: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { number?: number; error?: string }) =>
      values?.number !== undefined ? `${key}:${values.number}` : values?.error ? `${key}:${values.error}` : key,
  }),
}))

vi.mock('@/api', () => ({
  api: {
    getPlanReview: mocks.getPlanReview,
    listPlanRevisions: mocks.listPlanRevisions,
    savePlanReviewDraft: mocks.savePlanReviewDraft,
    continuePlanReviewDelivery: mocks.continuePlanReviewDelivery,
  },
}))

vi.mock('@/components/chat/file-diff-card', () => ({ FileDiffCard: () => <div /> }))
vi.mock('./plan-review-editor', () => ({ PlanReviewEditor: () => <div /> }))

vi.mock('@gravity-ui/icons', () => ({
  ChevronDown: () => null,
  Clock: () => null,
  Comment: () => null,
  TrashBin: () => null,
  TriangleExclamation: () => null,
  Xmark: () => null,
}))

vi.mock('@heroui/react', () => {
  const pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const Button = ({
    children,
    onPress,
    isDisabled,
    isPending: _isPending,
    isIconOnly: _isIconOnly,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    onPress?: () => void
    isDisabled?: boolean
    isPending?: boolean
    isIconOnly?: boolean
  }) => (
    <button {...props} disabled={isDisabled} onClick={onPress}>
      {children}
    </button>
  )
  const Dropdown = Object.assign(pass, {
    Popover: pass,
    Menu: pass,
    Item: ({ children, onAction }: { children?: React.ReactNode; onAction?: () => void }) => (
      <button onClick={onAction}>{children}</button>
    ),
  })
  const Tooltip = Object.assign(pass, { Content: pass })
  return {
    Button,
    Chip: pass,
    Dropdown,
    Spinner: () => null,
    TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
    Tooltip,
  }
})

vi.mock('@heroui-pro/react/segment', () => {
  const Segment = Object.assign(({ children }: { children?: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  })
  return { Segment }
})

vi.mock('@heroui-pro/react/sheet', () => {
  const pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const Sheet = Object.assign(
    ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) => (isOpen ? <>{children}</> : null),
    {
      Backdrop: pass,
      Content: pass,
      Dialog: pass,
      Header: pass,
      Heading: pass,
      CloseTrigger: () => null,
      Body: pass,
    },
  )
  return { Sheet }
})

function revision(id: string, revisionNo: number, markdown: string): PlanRevisionInfoResponse {
  return {
    id,
    document_id: 'document-1',
    revision_no: revisionNo,
    parent_revision_id: null,
    author_kind: 'assistant',
    content_markdown: markdown,
    content_sha256: `${id}-hash`,
    patch: null,
    responding_to_suggestion_revision_id: null,
    assistant_message_id: `message-${revisionNo}`,
    provider_call_id: `call-${revisionNo}`,
    editor_json: null,
    created_at: revisionNo,
  }
}

function review(
  reviewId: string,
  submitted: PlanRevisionInfoResponse,
  state: 'pending' | 'changes_requested',
  body?: string,
): PlanReviewInfoResponse {
  return {
    document: {
      id: 'document-1',
      conversation_id: 'conversation-1',
      state: 'reviewing',
      head_revision_id: submitted.id,
      approved_revision_id: null,
      working_generation: 0,
      file_rel_path: '.meridian/plans/plan.md',
      file_sync_state: 'applied',
      created_at: 1,
      updated_at: 1,
    },
    review: {
      id: reviewId,
      document_id: 'document-1',
      submitted_revision_id: submitted.id,
      state,
      decision_id: null,
      suggestion_revision_id: null,
      assistant_message_id: submitted.assistant_message_id!,
      provider_call_id: submitted.provider_call_id!,
      turn_id: `turn-${submitted.revision_no}`,
      lock_version: 0,
      created_at: 1,
      updated_at: 1,
    },
    submitted_revision: submitted,
    parent_revision: null,
    draft: {
      review_id: reviewId,
      base_revision_id: submitted.id,
      generation: 1,
      mode: 'source',
      base_editor_json: null,
      draft_editor_json: null,
      source_text: submitted.content_markdown,
      base_normalized_markdown: submitted.content_markdown,
      draft_normalized_markdown: submitted.content_markdown,
      draft_sha256: `${reviewId}-draft-hash`,
      global_note: body ? 'Old overall note' : null,
      selection: null,
      editor_schema_version: null,
      editor_schema_hash: null,
      created_at: 1,
      updated_at: 1,
    },
    comments: body
      ? [
          {
            id: 'old-comment',
            review_id: reviewId,
            position: 0,
            state: 'submitted',
            anchor: { kind: 'source_range', from: 2, to: 6, quote: 'Plan', prefix: '# ', suffix: '\n' },
            body,
            created_at: 1,
            updated_at: 1,
          },
        ]
      : [],
    delivery: null,
  }
}

describe('PlanReviewPage history feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
  })

  it('loads and shows submitted comments from the review attached to an older revision', async () => {
    const oldRevision = revision('revision-1', 1, '# Plan\n')
    const currentRevision = revision('revision-2', 2, '# Plan\n\nNext\n')
    const current = review('review-2', currentRevision, 'pending')
    const old = review('review-1', oldRevision, 'changes_requested', 'Keep the original scope')
    mocks.getPlanReview.mockImplementation(({ reviewId }: { reviewId: string }) =>
      Promise.resolve(reviewId === 'review-1' ? old : current),
    )
    mocks.listPlanRevisions.mockResolvedValue([oldRevision, currentRevision])
    usePlanReviewStore.setState({
      summaries: {
        'review-1': {
          review_id: 'review-1',
          conversation_id: 'conversation-1',
          document_id: 'document-1',
          revision_id: 'revision-1',
          assistant_message_id: 'message-1',
          provider_call_id: 'call-1',
          turn_id: 'turn-1',
          status: 'changes_requested',
          delivery_state: 'acknowledged',
          lock_version: 0,
        },
        'review-2': {
          review_id: 'review-2',
          conversation_id: 'conversation-1',
          document_id: 'document-1',
          revision_id: 'revision-2',
          assistant_message_id: 'message-2',
          provider_call_id: 'call-2',
          turn_id: 'turn-2',
          status: 'pending',
          delivery_state: null,
          lock_version: 0,
        },
      },
    })

    render(<PlanReviewPage reviewId="review-2" onClose={vi.fn()} />)
    await screen.findByText('planReview.history.item:1')
    await userEvent.click(screen.getByRole('button', { name: 'planReview.history.item:1' }))

    await waitFor(() => expect(mocks.getPlanReview).toHaveBeenCalledWith({ reviewId: 'review-1' }))
    expect(await screen.findByText('Keep the original scope')).toBeInTheDocument()
    expect(screen.getByText('Old overall note')).toBeInTheDocument()
  })

  it('refreshes when only delivery state changes and exposes held-delivery recovery', async () => {
    const currentRevision = revision('revision-2', 2, '# Plan\n')
    let current = review('review-2', currentRevision, 'pending')
    mocks.getPlanReview.mockImplementation(() => Promise.resolve(current))
    mocks.listPlanRevisions.mockResolvedValue([currentRevision])
    usePlanReviewStore.setState({
      summaries: {
        'review-2': {
          review_id: 'review-2',
          conversation_id: 'conversation-1',
          document_id: 'document-1',
          revision_id: 'revision-2',
          assistant_message_id: 'message-2',
          provider_call_id: 'call-2',
          turn_id: 'turn-2',
          status: 'pending',
          delivery_state: null,
          lock_version: 0,
        },
      },
    })

    render(<PlanReviewPage reviewId="review-2" onClose={vi.fn()} />)
    await screen.findByText('planReview.title')
    current = {
      ...current,
      review: { ...current.review, state: 'approved' },
      delivery: {
        id: 'delivery-1',
        review_id: 'review-2',
        target: 'native',
        state: 'held',
        payload: {},
        error: 'agent unavailable',
        created_at: 1,
        updated_at: 2,
      },
    }
    act(() => {
      usePlanReviewStore.setState({
        summaries: {
          'review-2': {
            review_id: 'review-2',
            conversation_id: 'conversation-1',
            document_id: 'document-1',
            revision_id: 'revision-2',
            assistant_message_id: 'message-2',
            provider_call_id: 'call-2',
            turn_id: 'turn-2',
            status: 'approved',
            delivery_state: 'held',
            lock_version: 1,
          },
        },
      })
    })

    await waitFor(() => expect(mocks.getPlanReview).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: 'planReview.continueDelivery' })).toBeInTheDocument()
  })

  it('lets a queued delivery resume after restart but does not retry an in-flight delivery', async () => {
    const currentRevision = revision('revision-2', 2, '# Plan\n')
    const queued = {
      ...review('review-2', currentRevision, 'pending'),
      review: { ...review('review-2', currentRevision, 'pending').review, state: 'approved' as const },
      delivery: {
        id: 'delivery-queued',
        review_id: 'review-2',
        target: 'native' as const,
        state: 'queued' as const,
        payload: {},
        error: null,
        created_at: 1,
        updated_at: 1,
      },
    }
    mocks.getPlanReview.mockResolvedValue(queued)
    mocks.listPlanRevisions.mockResolvedValue([currentRevision])
    mocks.continuePlanReviewDelivery.mockResolvedValue({ ...queued.delivery, state: 'dispatched' })

    const { rerender } = render(<PlanReviewPage reviewId="review-2" onClose={vi.fn()} />)
    const resume = await screen.findByRole('button', { name: 'planReview.continueDelivery' })
    expect(screen.getByText('planReview.deliveryQueued')).toBeInTheDocument()
    await userEvent.click(resume)

    await waitFor(() =>
      expect(mocks.continuePlanReviewDelivery).toHaveBeenCalledWith({ deliveryId: 'delivery-queued' }),
    )
    expect(await screen.findByText('planReview.deliveryDispatched')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'planReview.continueDelivery' })).not.toBeInTheDocument()

    rerender(<PlanReviewPage reviewId="review-2" onClose={vi.fn()} />)
  })
})
