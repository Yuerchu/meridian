import './plan-review-editor.css'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  MessagePlus,
  Quote,
  RotateCcw,
  RotateCw,
  Strikethrough,
} from '@keyline-icons/react/two-tone'
import type { JSONContent } from '@tiptap/core'

import {
  mappedPlanCommentAnchors,
  PlanCommentDecorations,
  proseMirrorAnchor,
  setPlanCommentDecorations,
} from '@/lib/plan-comment-decorations'
import { stripUnsupportedPasteMarks } from '@/lib/plan-paste'
import type { PlanCommentInfoResponse, PlanProseMirrorRange } from '@/types'

import {
  PlanTiptap,
  PlanTiptapActionButton,
  PlanTiptapBubbleMenu,
  PlanTiptapCommandButton,
  PlanTiptapContent,
  PlanTiptapLinkPopover,
  PlanTiptapShell,
  PlanTiptapToggleButton,
  PlanTiptapToolbar,
  PlanTiptapToolbarGroup,
  PlanTiptapToolbarSeparator,
  type PlanTiptapFormatCommand,
} from './plan-tiptap'
import { usePlanTiptap } from './plan-tiptap-context'

interface PlanReviewEditorProps {
  defaultValue: JSONContent
  comments: PlanCommentInfoResponse[]
  isReadOnly?: boolean
  /** A fresh object per request: the effect that scrolls to it keys on
   *  identity, so asking for the same range twice must not look like once. */
  focusAnchor?: PlanProseMirrorRange | null
  onChange: (document: JSONContent, anchors: Map<string, PlanProseMirrorRange | null>) => void
  onAddComment: (anchor: PlanProseMirrorRange) => void
  /** A click on a highlighted range in the text. */
  onCommentClick?: (commentId: string) => void
}

function CommentDecorationBridge({
  comments,
  focusAnchor,
}: {
  comments: PlanCommentInfoResponse[]
  focusAnchor?: PlanProseMirrorRange | null
}) {
  const { editor } = usePlanTiptap()

  useEffect(() => {
    if (!editor) return
    setPlanCommentDecorations(editor, comments)
  }, [comments, editor])

  useEffect(() => {
    if (!editor || !focusAnchor) return
    const maximum = editor.state.doc.content.size
    if (focusAnchor.from < 0 || focusAnchor.to > maximum || focusAnchor.from >= focusAnchor.to) return
    editor.chain().focus().setTextSelection({ from: focusAnchor.from, to: focusAnchor.to }).scrollIntoView().run()
  }, [editor, focusAnchor])

  return null
}

function FormatButton({ command, label, icon }: { command: PlanTiptapFormatCommand; label: string; icon: ReactNode }) {
  return <PlanTiptapToggleButton command={command} aria-label={label} tooltip={label} icon={icon} />
}

export function PlanReviewEditor({
  defaultValue,
  comments,
  isReadOnly = false,
  focusAnchor,
  onChange,
  onAddComment,
  onCommentClick,
}: PlanReviewEditorProps) {
  const { t } = useTranslation()
  // The extension is configured once — re-creating it would rebuild the editor
  // — so the handler it holds reads the latest prop through a ref.
  const commentClickRef = useRef(onCommentClick)
  commentClickRef.current = onCommentClick
  const extensions = useMemo(
    () => [PlanCommentDecorations.configure({ onCommentClick: (id: string) => commentClickRef.current?.(id) })],
    [],
  )
  const editorProps = useMemo(
    () => ({
      handleKeyDown: (_view: unknown, event: KeyboardEvent) => {
        // Markdown has no lossless underline syntax, so underline is omitted from
        // the schema and its platform shortcut is consumed before the WebView can
        // handle it.
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'u') {
          event.preventDefault()
          return true
        }
        return false
      },
      transformPasted: stripUnsupportedPasteMarks,
    }),
    [],
  )

  return (
    <PlanTiptap
      className="plan-review-rich-editor"
      defaultValue={defaultValue}
      extensions={extensions}
      editorProps={editorProps}
      isReadOnly={isReadOnly}
      placeholder={t('planReview.editor.placeholder')}
      onValueChange={(document, details) => onChange(document, mappedPlanCommentAnchors(details.editor, comments))}
    >
      <PlanTiptapShell>
        {!isReadOnly && (
          <PlanTiptapToolbar aria-label={t('planReview.editor.toolbar')}>
            <PlanTiptapToolbarGroup>
              <FormatButton command="heading-1" label={t('planReview.editor.heading1')} icon={<Heading1 />} />
              <FormatButton command="heading-2" label={t('planReview.editor.heading2')} icon={<Heading2 />} />
              <FormatButton command="heading-3" label={t('planReview.editor.heading3')} icon={<Heading3 />} />
            </PlanTiptapToolbarGroup>
            <PlanTiptapToolbarSeparator />
            <PlanTiptapToolbarGroup>
              <FormatButton command="bold" label={t('planReview.editor.bold')} icon={<Bold />} />
              <FormatButton command="italic" label={t('planReview.editor.italic')} icon={<Italic />} />
              <FormatButton command="strike" label={t('planReview.editor.strike')} icon={<Strikethrough />} />
              <FormatButton command="code" label={t('planReview.editor.code')} icon={<Code />} />
              <PlanTiptapLinkPopover
                label={t('planReview.editor.link')}
                urlLabel={t('planReview.editor.linkUrl')}
                removeLabel={t('planReview.editor.removeLink')}
                applyLabel={t('common.apply')}
                icon={<Link />}
              />
            </PlanTiptapToolbarGroup>
            <PlanTiptapToolbarSeparator />
            <PlanTiptapToolbarGroup>
              <FormatButton command="bulletList" label={t('planReview.editor.bulletList')} icon={<List />} />
              <FormatButton command="orderedList" label={t('planReview.editor.orderedList')} icon={<ListOrdered />} />
              <FormatButton command="blockquote" label={t('planReview.editor.quote')} icon={<Quote />} />
              <FormatButton command="codeBlock" label={t('planReview.editor.codeBlock')} icon={<Code />} />
            </PlanTiptapToolbarGroup>
            <PlanTiptapToolbarSeparator />
            <PlanTiptapToolbarGroup>
              <PlanTiptapActionButton
                action="undo"
                aria-label={t('common.undo')}
                tooltip={t('common.undo')}
                icon={<RotateCcw />}
              />
              <PlanTiptapActionButton
                action="redo"
                aria-label={t('common.redo')}
                tooltip={t('common.redo')}
                icon={<RotateCw />}
              />
            </PlanTiptapToolbarGroup>
          </PlanTiptapToolbar>
        )}

        <PlanTiptapContent />

        {!isReadOnly && (
          <PlanTiptapBubbleMenu aria-label={t('planReview.editor.selectionToolbar')}>
            <FormatButton command="bold" label={t('planReview.editor.bold')} icon={<Bold />} />
            <FormatButton command="italic" label={t('planReview.editor.italic')} icon={<Italic />} />
            <FormatButton command="strike" label={t('planReview.editor.strike')} icon={<Strikethrough />} />
            <PlanTiptapCommandButton
              aria-label={t('planReview.comments.add')}
              tooltip={t('planReview.comments.add')}
              disabled={(editor) => editor.state.selection.empty}
              onCommand={(editor) => {
                const { from, to } = editor.state.selection
                if (from < to) onAddComment(proseMirrorAnchor(editor.state.doc, from, to))
              }}
              icon={<MessagePlus />}
            />
          </PlanTiptapBubbleMenu>
        )}

        <CommentDecorationBridge comments={comments} focusAnchor={focusAnchor} />
      </PlanTiptapShell>
    </PlanTiptap>
  )
}
