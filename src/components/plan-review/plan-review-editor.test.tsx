import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'

import type { PlanCommentInfoResponse, PlanProseMirrorRange } from '@/types'
import { PlanReviewEditor } from './plan-review-editor'
import { PlanTiptap, PlanTiptapContent } from './plan-tiptap'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@keyline-icons/react/two-tone', () => ({
  Bold: () => null,
  Code: () => null,
  Heading1: () => null,
  Heading2: () => null,
  Heading3: () => null,
  Italic: () => null,
  Link: () => null,
  List: () => null,
  ListOrdered: () => null,
  MessagePlus: () => null,
  Quote: () => null,
  RotateCcw: () => null,
  RotateCw: () => null,
  Strikethrough: () => null,
}))

const sampleDoc: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Add ' },
        { type: 'text', text: 'export_bundle', marks: [{ type: 'code' }] },
        { type: 'text', text: ' target' },
      ],
    },
  ],
}

function makeComment(
  id: string,
  from: number,
  to: number,
  state: PlanCommentInfoResponse['state'] = 'active',
): PlanCommentInfoResponse {
  return {
    id,
    review_id: 'review-1',
    position: 0,
    state,
    anchor: {
      kind: 'prosemirror_range',
      from,
      to,
      quote: 'Add',
      prefix: '',
      suffix: '',
    },
    body: 'Check this',
    created_at: 1,
    updated_at: 1,
  }
}

describe('PlanTiptap & PlanReviewEditor', () => {
  const originalRangeGetClientRects = Range.prototype.getClientRects
  const originalRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect
  const originalElementScrollIntoView = Element.prototype.scrollIntoView
  const originalWindowScrollBy = window.scrollBy

  beforeAll(() => {
    const emptyRect = new DOMRect(0, 0, 10, 10)
    Range.prototype.getClientRects = () => [emptyRect] as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => emptyRect
    Element.prototype.scrollIntoView = vi.fn()
    window.scrollBy = vi.fn()
  })

  afterAll(() => {
    Range.prototype.getClientRects = originalRangeGetClientRects
    Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect
    Element.prototype.scrollIntoView = originalElementScrollIntoView
    window.scrollBy = originalWindowScrollBy
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('draws inline code without literal CSS backticks and keeps the .plan-review-rich-editor hook', async () => {
    const { container } = render(
      <PlanReviewEditor defaultValue={sampleDoc} comments={[]} onChange={vi.fn()} onAddComment={vi.fn()} />,
    )

    await waitFor(() => expect(container.querySelector('.ProseMirror code')).toHaveTextContent('export_bundle'))
    expect(container.querySelector('[data-slot="plan-tiptap"]')).toHaveClass(
      'plan-review-rich-editor',
      'm-plan-review-editor',
    )

    const css = readFileSync(join(process.cwd(), 'src/components/plan-review/plan-tiptap.css'), 'utf8')
    expect(css).toContain('.m-plan-review-editor__content .ProseMirror code::before')
    expect(css).toContain('content: none;')
  })

  it('sets placeholder on empty documents', async () => {
    const { container } = render(
      <PlanTiptap defaultValue={{ type: 'doc', content: [{ type: 'paragraph' }] }} placeholder="Write the plan">
        <PlanTiptapContent />
      </PlanTiptap>,
    )

    await waitFor(() =>
      expect(container.querySelector('.ProseMirror p')).toHaveAttribute('data-placeholder', 'Write the plan'),
    )
  })

  it('executes formatting commands, updates active state, and supports undo/redo', async () => {
    const onChange = vi.fn()
    const anchor: PlanProseMirrorRange = {
      kind: 'prosemirror_range',
      from: 1,
      to: 4,
      quote: 'Add',
      prefix: '',
      suffix: '',
    }

    const { container } = render(
      <PlanReviewEditor
        defaultValue={sampleDoc}
        comments={[]}
        focusAnchor={anchor}
        onChange={onChange}
        onAddComment={vi.fn()}
      />,
    )

    const toolbar = await screen.findByRole('toolbar', { name: 'planReview.editor.toolbar' })
    const boldButton = within(toolbar).getByRole('button', { name: 'planReview.editor.bold' })
    const undoButton = within(toolbar).getByRole('button', { name: 'common.undo' })
    const redoButton = within(toolbar).getByRole('button', { name: 'common.redo' })

    expect(boldButton).toHaveAttribute('aria-pressed', 'false')
    expect(undoButton).toBeDisabled()
    expect(redoButton).toBeDisabled()

    await userEvent.click(boldButton)

    await waitFor(() => expect(boldButton).toHaveAttribute('aria-pressed', 'true'))
    expect(boldButton).toHaveAttribute('data-active', 'true')
    expect(container.querySelector('.ProseMirror strong')).toHaveTextContent('Add')
    expect(onChange).toHaveBeenCalled()
    expect(undoButton).toBeEnabled()

    await userEvent.click(undoButton)
    await waitFor(() => expect(boldButton).toHaveAttribute('aria-pressed', 'false'))
    expect(container.querySelector('.ProseMirror strong')).toBeNull()
    expect(redoButton).toBeEnabled()

    await userEvent.click(redoButton)
    await waitFor(() => expect(boldButton).toHaveAttribute('aria-pressed', 'true'))
    expect(container.querySelector('.ProseMirror strong')).toHaveTextContent('Add')

    for (const [label, selector] of [
      ['planReview.editor.italic', '.ProseMirror em'],
      ['planReview.editor.strike', '.ProseMirror s'],
      ['planReview.editor.heading2', '.ProseMirror h2'],
    ] as const) {
      const btn = within(toolbar).getByRole('button', { name: label })
      await userEvent.click(btn)
      await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'true'))
      expect(container.querySelector(selector)).not.toBeNull()
    }

    for (const [label, selector] of [
      ['planReview.editor.bulletList', '.ProseMirror ul'],
      ['planReview.editor.orderedList', '.ProseMirror ol'],
      ['planReview.editor.quote', '.ProseMirror blockquote'],
      ['planReview.editor.codeBlock', '.ProseMirror pre'],
    ] as const) {
      const btn = within(toolbar).getByRole('button', { name: label })
      await userEvent.click(btn)
      await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'true'))
      expect(container.querySelector(selector)).not.toBeNull()
      // Toggle back to a plain paragraph before exercising the next block node.
      await userEvent.click(btn)
      await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'false'))
    }
  })

  it('applies and removes links through the link popover', async () => {
    const anchor: PlanProseMirrorRange = {
      kind: 'prosemirror_range',
      from: 1,
      to: 4,
      quote: 'Add',
      prefix: '',
      suffix: '',
    }

    const { container } = render(
      <PlanReviewEditor
        defaultValue={sampleDoc}
        comments={[]}
        focusAnchor={anchor}
        onChange={vi.fn()}
        onAddComment={vi.fn()}
      />,
    )

    const toolbar = await screen.findByRole('toolbar', { name: 'planReview.editor.toolbar' })
    const linkButton = within(toolbar).getByRole('button', { name: 'planReview.editor.link' })
    await userEvent.click(linkButton)

    const dialog = await screen.findByRole('dialog', { name: 'planReview.editor.link' })
    const urlInput = within(dialog).getByLabelText('planReview.editor.linkUrl')
    const applyButton = within(dialog).getByRole('button', { name: 'common.apply' })
    expect(applyButton).toBeDisabled()

    await userEvent.type(urlInput, 'https://example.com')
    expect(applyButton).toBeEnabled()
    await userEvent.click(applyButton)

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'planReview.editor.link' })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(linkButton).toHaveAttribute('aria-pressed', 'true'))
    expect(container.querySelector('.ProseMirror a')).toHaveAttribute('href', 'https://example.com')

    // Re-opening pre-fills the existing href and Remove unsets it.
    await userEvent.click(linkButton)
    const reopened = await screen.findByRole('dialog', { name: 'planReview.editor.link' })
    expect(within(reopened).getByLabelText('planReview.editor.linkUrl')).toHaveValue('https://example.com')
    await userEvent.click(within(reopened).getByRole('button', { name: 'planReview.editor.removeLink' }))

    await waitFor(() => expect(linkButton).toHaveAttribute('aria-pressed', 'false'))
    expect(container.querySelector('.ProseMirror a')).toBeNull()
  })

  it('hides toolbar and bubble menu and sets contenteditable=false in read-only mode', async () => {
    const { container, rerender } = render(
      <PlanReviewEditor defaultValue={sampleDoc} comments={[]} isReadOnly onChange={vi.fn()} onAddComment={vi.fn()} />,
    )

    await waitFor(() => expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false'))
    expect(screen.queryByRole('toolbar', { name: 'planReview.editor.toolbar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'planReview.editor.selectionToolbar' })).not.toBeInTheDocument()

    rerender(
      <PlanReviewEditor
        defaultValue={sampleDoc}
        comments={[]}
        isReadOnly={false}
        onChange={vi.fn()}
        onAddComment={vi.fn()}
      />,
    )

    await waitFor(() => expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'true'))
    expect(screen.getByRole('toolbar', { name: 'planReview.editor.toolbar' })).toBeInTheDocument()
  })

  it('renders comment decorations for active comments only and remaps anchors on edit', async () => {
    const onChange = vi.fn()
    const comments: PlanCommentInfoResponse[] = [
      makeComment('c-active', 1, 4, 'active'),
      makeComment('c-orphaned', 5, 8, 'orphaned'),
      makeComment('c-deleted', 5, 8, 'deleted'),
    ]

    const rendered = render(
      <PlanReviewEditor
        defaultValue={sampleDoc}
        comments={comments}
        onChange={onChange}
        onAddComment={vi.fn()}
        onCommentClick={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(rendered.container.querySelector('[data-plan-comment-id="c-active"]')).toHaveClass(
        'plan-comment-highlight',
      ),
    )
    expect(rendered.container.querySelector('[data-plan-comment-id="c-orphaned"]')).toBeNull()
    expect(rendered.container.querySelector('[data-plan-comment-id="c-deleted"]')).toBeNull()
    expect(rendered.container.querySelector('[data-plan-comment-id="c-active"]')).toHaveTextContent('Add')

    rendered.rerender(
      <PlanReviewEditor
        defaultValue={sampleDoc}
        comments={comments}
        focusAnchor={{ kind: 'prosemirror_range', from: 1, to: 4, quote: 'Add', prefix: '', suffix: '' }}
        onChange={onChange}
        onAddComment={vi.fn()}
        onCommentClick={vi.fn()}
      />,
    )
    const toolbar = within(rendered.container).getByRole('toolbar', { name: 'planReview.editor.toolbar' })
    await userEvent.click(within(toolbar).getByRole('button', { name: 'planReview.editor.heading2' }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const [, anchors] = onChange.mock.calls.at(-1) as [JSONContent, Map<string, PlanProseMirrorRange | null>]
    expect(anchors.get('c-active')).toMatchObject({ kind: 'prosemirror_range', quote: 'Add' })
    expect(anchors.get('c-deleted')).toBeNull()
  })

  it('calls onAddComment from the selection bubble menu with the active ProseMirror range', async () => {
    const onAddComment = vi.fn()
    const focusAnchor: PlanProseMirrorRange = {
      kind: 'prosemirror_range',
      from: 1,
      to: 4,
      quote: 'Add',
      prefix: '',
      suffix: '',
    }

    render(
      <PlanReviewEditor
        defaultValue={sampleDoc}
        comments={[]}
        focusAnchor={focusAnchor}
        onChange={vi.fn()}
        onAddComment={onAddComment}
      />,
    )

    const addCommentButton = await screen.findByRole('button', { name: 'planReview.comments.add' })
    await waitFor(() => expect(addCommentButton).toBeEnabled())
    await userEvent.click(addCommentButton)

    expect(onAddComment).toHaveBeenCalledWith({
      kind: 'prosemirror_range',
      from: 1,
      to: 4,
      quote: 'Add',
      prefix: '',
      suffix: ' export_bundle target',
    })
  })

  it('prevents Ctrl/Cmd+U and strips unsupported underline marks on paste', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <PlanReviewEditor defaultValue={sampleDoc} comments={[]} onChange={onChange} onAddComment={vi.fn()} />,
    )

    const proseMirror = await waitFor(() => {
      const el = container.querySelector('.ProseMirror')
      expect(el).not.toBeNull()
      return el!
    })

    const ctrlU = new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      proseMirror.dispatchEvent(ctrlU)
    })
    expect(ctrlU.defaultPrevented).toBe(true)

    const metaU = new KeyboardEvent('keydown', { key: 'U', metaKey: true, bubbles: true, cancelable: true })
    act(() => {
      proseMirror.dispatchEvent(metaU)
    })
    expect(metaU.defaultPrevented).toBe(true)

    const clipboardData = {
      getData: (type: string) =>
        type === 'text/html' ? '<p><u>plain</u> <b>bold</b></p>' : type === 'text/plain' ? 'plain bold' : '',
    }
    act(() => {
      fireEvent.paste(proseMirror, { clipboardData })
    })

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const [doc] = onChange.mock.calls.at(-1) as [JSONContent]
    const serialized = JSON.stringify(doc)
    expect(serialized).not.toContain('"underline"')
    expect(serialized).toContain('plain')
  })
})
