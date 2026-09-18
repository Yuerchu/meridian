import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JSONContent } from '@tiptap/core'

import { usePlanReviewStore } from '@/stores/plan-review-store'
import type { PlanProseMirrorRange, PlanReviewInfoResponse, PlanRevisionInfoResponse } from '@/types'
import { PlanReviewPage } from './plan-review-page'

const mocks = vi.hoisted(() => ({
  getPlanReview: vi.fn(),
  listPlanRevisions: vi.fn(),
  savePlanReviewDraft: vi.fn(),
  continuePlanReviewDelivery: vi.fn(),
  decidePlanReview: vi.fn(),
  editorOnChange: null as null | ((document: JSONContent, anchors: Map<string, PlanProseMirrorRange | null>) => void),
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
    decidePlanReview: mocks.decidePlanReview,
  },
}))

vi.mock('@/components/chat/file-diff-card', () => ({ FileDiffCard: () => <div /> }))
vi.mock('./plan-review-editor', () => ({
  PlanReviewEditor: (props: { onChange: NonNullable<typeof mocks.editorOnChange> }) => {
    mocks.editorOnChange = props.onChange
    return <div data-testid="rich-editor" />
  },
}))

vi.mock('@gravity-ui/icons', () => ({
  ChevronDown: () => null,
  Clock: () => null,
  Comment: () => null,
  TrashBin: () => null,
  TriangleExclamation: () => null,
  Xmark: () => null,
}))

vi.mock('@/components/base', async () => {
  const { createContext, useContext, useId } = await import('react')
  const pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  // The real TextField wires its Label to its TextArea through context; the
  // mock does the same so `getByLabelText` reaches the control.
  const FieldId = createContext<string | undefined>(undefined)
  const TextField = ({ children }: { children?: React.ReactNode }) => (
    <FieldId.Provider value={useId()}>
      <div>{children}</div>
    </FieldId.Provider>
  )
  const Label = ({ children }: { children?: React.ReactNode }) => (
    <label htmlFor={useContext(FieldId)}>{children}</label>
  )
  const TextArea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea id={useContext(FieldId)} {...props} />
  )
  const Button = ({
    children,
    onPress,
    isDisabled,
    isPending: _isPending,
    iconOnly: _iconOnly,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    onPress?: () => void
    isDisabled?: boolean
    isPending?: boolean
    iconOnly?: boolean
  }) => (
    <button {...props} disabled={isDisabled} onClick={onPress}>
      {children}
    </button>
  )
  // One factory, not three: `vi.mock` keys on the module path, so a later call
  // for the same path replaces the earlier one entirely rather than merging.
  const Dropdown = Object.assign(pass, {
    Popover: pass,
    Menu: pass,
    Item: ({ children, onAction }: { children?: React.ReactNode; onAction?: () => void }) => (
      <button onClick={onAction}>{children}</button>
    ),
  })
  const DropdownPopover = pass
  const DropdownItem = ({ children, onAction }: { children?: React.ReactNode; onAction?: () => void }) => (
    <button onClick={onAction}>{children}</button>
  )
  const Tooltip = Object.assign(pass, {
    Content: pass,
    Trigger: ({ children, render }: { children?: React.ReactNode; render?: (props: object) => React.ReactNode }) =>
      render ? render({ children }) : <>{children}</>,
  })
  const TooltipTrigger = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const Link = ({
    children,
    onPress,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { onPress?: () => void }) => (
    <a {...props} onClick={onPress}>
      {children}
    </a>
  )
  const Segment = Object.assign(({ children }: { children?: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  })
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
  return {
    Button,
    Chip: pass,
    Description: pass,
    Dropdown,
    DropdownItem,
    DropdownPopover,
    Label,
    Link,
    Segment,
    Sheet,
    Skeleton: () => <div />,
    TextArea,
    TextField,
    Tooltip,
    TooltipTrigger,
  }
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
    await screen.findByText('planReview.revision:1')
    await userEvent.click(screen.getByRole('button', { name: 'planReview.revision:1' }))

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

describe('PlanReviewPage rich editor values', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.editorOnChange = null
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
  })

  function untouchedRichReview() {
    const currentRevision = revision('revision-1', 1, '# Plan\n\n- last item\n')
    const current = review('review-1', currentRevision, 'pending')
    return { ...current, draft: { ...current.draft, generation: 0 } }
  }

  it('does not read the editor-appended trailing paragraph as an edit, and names a refused value without a template', async () => {
    mocks.getPlanReview.mockResolvedValue(untouchedRichReview())
    mocks.listPlanRevisions.mockResolvedValue([])

    render(<PlanReviewPage reviewId="review-1" onClose={vi.fn()} />)
    await screen.findByTestId('rich-editor')
    const onChange = mocks.editorOnChange
    expect(onChange).not.toBeNull()

    // What the live editor reports after a click: the parsed document plus
    // StarterKit's trailing paragraph. Not an edit, so nothing to save.
    act(() => {
      onChange!(
        {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
            {
              type: 'bulletList',
              content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'last item' }] }] },
              ],
            },
            { type: 'paragraph' },
          ],
        },
        new Map(),
      )
    })
    expect(screen.getByRole('status')).toHaveTextContent('planReview.save.saved')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.savePlanReviewDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'planReview.approve' })).toBeEnabled()

    // A value Markdown genuinely cannot hold: the status names the failure
    // instead of leaking the banner's `{{error}}` template, and deciding waits.
    act(() => {
      onChange!(
        {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Line' }, { type: 'hardBreak' }] }],
        },
        new Map(),
      )
    })
    expect(screen.getByRole('status')).toHaveTextContent('planReview.save.failed')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'planReview.save.error:Error: serialized plan Markdown changes the editor document semantics',
    )
    expect(screen.getByRole('button', { name: 'planReview.approve' })).toBeDisabled()

    // The next acceptable edit clears it without a reload.
    act(() => {
      onChange!({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Line' }] }] }, new Map())
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('planReview.save.dirty')
  })
})

describe('PlanReviewPage comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
  })

  it('does not save a comment box until something is typed into it', async () => {
    const currentRevision = revision('revision-1', 1, '# Plan\n')
    mocks.getPlanReview.mockResolvedValue(review('review-1', currentRevision, 'pending'))
    mocks.listPlanRevisions.mockResolvedValue([currentRevision])
    mocks.savePlanReviewDraft.mockResolvedValue({ generation: 2, draft_sha256: 'next' })

    render(<PlanReviewPage reviewId="review-1" onClose={vi.fn()} />)
    const source = (await screen.findByLabelText('planReview.source.label')) as HTMLTextAreaElement
    source.setSelectionRange(2, 6)
    fireEvent.select(source)
    await userEvent.click(screen.getByRole('button', { name: 'planReview.comments.add' }))

    // Rendered twice: the aside and the sheet the add button opens draw the same pane.
    const [box] = await screen.findAllByLabelText('planReview.comments.commentLabel')
    await new Promise((resolve) => setTimeout(resolve, 600))
    // Selecting text is persisted on its own, so a save may run; the box is not in it.
    for (const [request] of mocks.savePlanReviewDraft.mock.calls) expect(request.comments).toEqual([])
    expect(screen.getByRole('button', { name: 'planReview.approve' })).toBeEnabled()

    fireEvent.change(box, { target: { value: 'Tighten this' } })
    await waitFor(() =>
      expect(mocks.savePlanReviewDraft.mock.calls.at(-1)?.[0].comments).toMatchObject([{ body: 'Tighten this' }]),
    )
  })
})

describe('PlanReviewPage save lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePlanReviewStore.setState({ activeReviewId: null, summaries: {} })
  })

  it('flushes the debounced draft when the page is closed instead of dropping it', async () => {
    const currentRevision = revision('revision-1', 1, '# Plan\n')
    mocks.getPlanReview.mockResolvedValue(review('review-1', currentRevision, 'pending'))
    mocks.listPlanRevisions.mockResolvedValue([currentRevision])
    mocks.savePlanReviewDraft.mockResolvedValue({ generation: 2, draft_sha256: 'next' })

    const { unmount } = render(<PlanReviewPage reviewId="review-1" onClose={vi.fn()} />)
    const note = await screen.findByLabelText('planReview.comments.globalNote')
    fireEvent.change(note, { target: { value: 'Ship it' } })
    expect(mocks.savePlanReviewDraft).not.toHaveBeenCalled()

    unmount()
    await waitFor(() => expect(mocks.savePlanReviewDraft).toHaveBeenCalledTimes(1))
    expect(mocks.savePlanReviewDraft.mock.calls[0][0].globalNote).toBe('Ship it')
  })

  it('selecting source text does not save; only a comment does', async () => {
    const currentRevision = revision('revision-1', 1, '# Plan\n')
    mocks.getPlanReview.mockResolvedValue(review('review-1', currentRevision, 'pending'))
    mocks.listPlanRevisions.mockResolvedValue([currentRevision])

    render(<PlanReviewPage reviewId="review-1" onClose={vi.fn()} />)
    const source = (await screen.findByLabelText('planReview.source.label')) as HTMLTextAreaElement
    source.setSelectionRange(2, 6)
    fireEvent.select(source)
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(mocks.savePlanReviewDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('planReview.save.saved')
  })

  it('lists the submitted revision once, as the current review', async () => {
    const older = revision('revision-1', 1, '# Plan\n')
    const currentRevision = revision('revision-2', 2, '# Plan\n\nNext\n')
    mocks.getPlanReview.mockResolvedValue(review('review-2', currentRevision, 'pending'))
    mocks.listPlanRevisions.mockResolvedValue([older, currentRevision])

    render(<PlanReviewPage reviewId="review-2" onClose={vi.fn()} />)
    await screen.findByText('planReview.revision:1')
    expect(screen.queryByRole('button', { name: 'planReview.revision:2' })).not.toBeInTheDocument()
  })

  it('says which decision is still in doubt, in its own words, and offers a reload', async () => {
    const currentRevision = revision('revision-1', 1, '# Plan\n')
    const current = review('review-1', currentRevision, 'pending')
    mocks.getPlanReview.mockResolvedValue({ ...current, draft: { ...current.draft, global_note: 'Overall' } })
    mocks.listPlanRevisions.mockResolvedValue([currentRevision])
    mocks.savePlanReviewDraft.mockResolvedValue({ generation: 2, draft_sha256: 'next' })
    mocks.decidePlanReview.mockRejectedValue(new Error('network down'))

    render(<PlanReviewPage reviewId="review-1" onClose={vi.fn()} />)
    const requestChanges = await screen.findByRole('button', { name: 'planReview.requestChanges' })
    await waitFor(() => expect(requestChanges).toBeEnabled())
    await userEvent.click(requestChanges)
    expect(await screen.findByText('Error: network down')).toBeInTheDocument()

    // Withdraw the note so the other decision becomes available, then press it:
    // not a raw English string, and a way out beside it.
    mocks.decidePlanReview.mockResolvedValue({ state: 'approved', delivery_state: null })
    fireEvent.change(screen.getByLabelText('planReview.comments.globalNote'), { target: { value: '' } })
    const approve = screen.getByRole('button', { name: 'planReview.approve' })
    await waitFor(() => expect(approve).toBeEnabled())
    await userEvent.click(approve)
    expect(await screen.findByText('planReview.decision.inDoubt')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'planReview.reload' }).length).toBeGreaterThan(0)
  })
})
