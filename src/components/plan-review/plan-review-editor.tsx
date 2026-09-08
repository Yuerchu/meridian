import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ArrowRotateLeft,
  ArrowRotateRight,
  Bold,
  Code,
  CommentPlus,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  ListOl,
  ListUl,
  QuoteOpen,
  Strikethrough,
} from '@gravity-ui/icons'
import type { JSONContent } from '@tiptap/core'
import { Tooltip } from '@heroui/react'
import { RichTextEditor, useRichTextEditor, type RichTextEditorFormatCommand } from '@heroui-pro/react/rich-text-editor'

import {
  mappedPlanCommentAnchors,
  PlanCommentDecorations,
  proseMirrorAnchor,
  setPlanCommentDecorations,
} from '@/lib/plan-comment-decorations'
import { stripUnsupportedPasteMarks } from '@/lib/plan-paste'
import type { PlanCommentInfoResponse, PlanProseMirrorRange } from '@/types'

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
  const { editor } = useRichTextEditor()

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

function FormatButton({
  command,
  label,
  icon,
}: {
  command: RichTextEditorFormatCommand
  label: string
  icon: React.ReactNode
}) {
  return (
    <RichTextEditor.ToggleButton command={command} aria-label={label} tooltip={label}>
      {icon}
    </RichTextEditor.ToggleButton>
  )
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
  const editorOptions = useMemo(
    () => ({
      editorProps: {
        handleKeyDown: (_view: unknown, event: KeyboardEvent) => {
          // HeroUI Pro includes Underline in its default extension set. Markdown
          // has no lossless underline syntax, so the command is deliberately
          // absent from this editor and its platform shortcut is consumed.
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'u') {
            event.preventDefault()
            return true
          }
          return false
        },
        transformPasted: stripUnsupportedPasteMarks,
      },
    }),
    [],
  )

  return (
    <RichTextEditor
      className="plan-review-rich-editor h-full min-h-0"
      defaultValue={defaultValue}
      extensions={extensions}
      editorOptions={editorOptions}
      isReadOnly={isReadOnly}
      placeholder={t('planReview.editor.placeholder')}
      onValueChange={(document, details) => onChange(document, mappedPlanCommentAnchors(details.editor, comments))}
    >
      <RichTextEditor.Shell className="flex h-full min-h-0 flex-col">
        {!isReadOnly && (
          <RichTextEditor.Toolbar aria-label={t('planReview.editor.toolbar')}>
            <RichTextEditor.ToolbarGroup>
              <FormatButton command="heading-1" label={t('planReview.editor.heading1')} icon={<Heading1 />} />
              <FormatButton command="heading-2" label={t('planReview.editor.heading2')} icon={<Heading2 />} />
              <FormatButton command="heading-3" label={t('planReview.editor.heading3')} icon={<Heading3 />} />
            </RichTextEditor.ToolbarGroup>
            <RichTextEditor.ToolbarSeparator />
            <RichTextEditor.ToolbarGroup>
              <FormatButton command="bold" label={t('planReview.editor.bold')} icon={<Bold />} />
              <FormatButton command="italic" label={t('planReview.editor.italic')} icon={<Italic />} />
              <FormatButton command="strike" label={t('planReview.editor.strike')} icon={<Strikethrough />} />
              <FormatButton command="code" label={t('planReview.editor.code')} icon={<Code />} />
              <RichTextEditor.LinkPopover>
                <Tooltip delay={0}>
                  <RichTextEditor.LinkPopover.Trigger aria-label={t('planReview.editor.link')}>
                    <Link />
                  </RichTextEditor.LinkPopover.Trigger>
                  <Tooltip.Content>{t('planReview.editor.link')}</Tooltip.Content>
                </Tooltip>
                <RichTextEditor.LinkPopover.Content>
                  <RichTextEditor.LinkPopover.Input aria-label={t('planReview.editor.linkUrl')} />
                  <RichTextEditor.LinkPopover.Actions>
                    <RichTextEditor.LinkPopover.UnsetButton>
                      {t('planReview.editor.removeLink')}
                    </RichTextEditor.LinkPopover.UnsetButton>
                    <RichTextEditor.LinkPopover.ApplyButton>{t('common.apply')}</RichTextEditor.LinkPopover.ApplyButton>
                  </RichTextEditor.LinkPopover.Actions>
                </RichTextEditor.LinkPopover.Content>
              </RichTextEditor.LinkPopover>
            </RichTextEditor.ToolbarGroup>
            <RichTextEditor.ToolbarSeparator />
            <RichTextEditor.ToolbarGroup>
              <FormatButton command="bulletList" label={t('planReview.editor.bulletList')} icon={<ListUl />} />
              <FormatButton command="orderedList" label={t('planReview.editor.orderedList')} icon={<ListOl />} />
              <FormatButton command="blockquote" label={t('planReview.editor.quote')} icon={<QuoteOpen />} />
              <FormatButton command="codeBlock" label={t('planReview.editor.codeBlock')} icon={<Code />} />
            </RichTextEditor.ToolbarGroup>
            <RichTextEditor.ToolbarSeparator />
            <RichTextEditor.ToolbarGroup>
              <RichTextEditor.ActionButton action="undo" aria-label={t('common.undo')} tooltip={t('common.undo')}>
                <ArrowRotateLeft />
              </RichTextEditor.ActionButton>
              <RichTextEditor.ActionButton action="redo" aria-label={t('common.redo')} tooltip={t('common.redo')}>
                <ArrowRotateRight />
              </RichTextEditor.ActionButton>
            </RichTextEditor.ToolbarGroup>
          </RichTextEditor.Toolbar>
        )}

        <RichTextEditor.Content className="min-h-0 flex-1 overflow-y-auto" />

        {!isReadOnly && (
          <RichTextEditor.BubbleMenu aria-label={t('planReview.editor.selectionToolbar')}>
            <FormatButton command="bold" label={t('planReview.editor.bold')} icon={<Bold />} />
            <FormatButton command="italic" label={t('planReview.editor.italic')} icon={<Italic />} />
            <FormatButton command="strike" label={t('planReview.editor.strike')} icon={<Strikethrough />} />
            <RichTextEditor.CommandButton
              aria-label={t('planReview.comments.add')}
              tooltip={t('planReview.comments.add')}
              isDisabled={(editor) => editor.state.selection.empty}
              onCommand={(editor) => {
                const { from, to } = editor.state.selection
                if (from < to) onAddComment(proseMirrorAnchor(editor.state.doc, from, to))
              }}
            >
              <CommentPlus />
            </RichTextEditor.CommandButton>
          </RichTextEditor.BubbleMenu>
        )}

        <CommentDecorationBridge comments={comments} focusAnchor={focusAnchor} />
      </RichTextEditor.Shell>
    </RichTextEditor>
  )
}
