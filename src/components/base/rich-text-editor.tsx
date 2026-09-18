import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from 'react'
import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Placeholder, CharacterCount } from '@tiptap/extensions'
import type { Extension } from '@tiptap/core'
import { cx } from '@/utils/cx'
import { Button } from './buttons/button'
import { Tooltip, TooltipTrigger } from './tooltip/tooltip'

export type RichTextEditorFormatCommand =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'underline'
  | 'code'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'

const RteContext = createContext<{ editor: Editor | null }>({ editor: null })

export function useRichTextEditor() {
  return useContext(RteContext)
}

interface RichTextEditorProps extends Omit<ComponentProps<'div'>, 'defaultValue'> {
  defaultValue?: JSONContent
  extensions?: Extension[]
  editorOptions?: Record<string, unknown>
  isReadOnly?: boolean
  placeholder?: string
  maxLength?: number
  onValueChange?: (document: JSONContent, details: { editor: Editor }) => void
}

function RichTextEditorRoot({
  className,
  defaultValue,
  extensions: userExtensions = [],
  isReadOnly = false,
  placeholder: placeholderText,
  maxLength,
  onValueChange,
  children,
  ...props
}: RichTextEditorProps) {
  const allExtensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholderText }),
      ...(maxLength != null ? [CharacterCount.configure({ limit: maxLength })] : []),
      ...userExtensions,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extensions are stable
    [placeholderText, maxLength],
  )

  const editor = useEditor({
    extensions: allExtensions,
    content: defaultValue,
    editable: !isReadOnly,
    onUpdate: ({ editor: e }) => {
      onValueChange?.(e.getJSON(), { editor: e })
    },
  })

  return (
    <RteContext.Provider value={{ editor }}>
      <div data-slot="rich-text-editor" {...props} className={cx('flex flex-col', className)}>
        {children}
      </div>
    </RteContext.Provider>
  )
}

function RteShell({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="rich-text-editor-shell"
      {...props}
      className={cx(
        'rich-text-editor__shell overflow-hidden rounded-xl border border-border-button-default bg-background-primary-default',
        className,
      )}
    />
  )
}

function RteToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="rich-text-editor-toolbar"
      role="toolbar"
      {...props}
      className={cx(
        'rich-text-editor__toolbar flex items-center gap-0.5 border-b border-separator-border px-2 py-1',
        className,
      )}
    />
  )
}

function RteToolbarGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="rich-text-editor-toolbar-group" {...props} className={cx('flex items-center gap-0.5', className)} />
  )
}

function RteToolbarSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="rich-text-editor-toolbar-separator"
      {...props}
      className={cx('mx-1 h-5 w-px bg-separator-border', className)}
    />
  )
}

const commandMap: Record<RichTextEditorFormatCommand, (editor: Editor) => void> = {
  'heading-1': (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  'heading-2': (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  'heading-3': (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  bold: (e) => e.chain().focus().toggleBold().run(),
  italic: (e) => e.chain().focus().toggleItalic().run(),
  strike: (e) => e.chain().focus().toggleStrike().run(),
  underline: (e) => e.chain().focus().toggleUnderline().run(),
  code: (e) => e.chain().focus().toggleCode().run(),
  codeBlock: (e) => e.chain().focus().toggleCodeBlock().run(),
  bulletList: (e) => e.chain().focus().toggleBulletList().run(),
  orderedList: (e) => e.chain().focus().toggleOrderedList().run(),
  blockquote: (e) => e.chain().focus().toggleBlockquote().run(),
}

const activeCheck: Record<RichTextEditorFormatCommand, (editor: Editor) => boolean> = {
  'heading-1': (e) => e.isActive('heading', { level: 1 }),
  'heading-2': (e) => e.isActive('heading', { level: 2 }),
  'heading-3': (e) => e.isActive('heading', { level: 3 }),
  bold: (e) => e.isActive('bold'),
  italic: (e) => e.isActive('italic'),
  strike: (e) => e.isActive('strike'),
  underline: (e) => e.isActive('underline'),
  code: (e) => e.isActive('code'),
  codeBlock: (e) => e.isActive('codeBlock'),
  bulletList: (e) => e.isActive('bulletList'),
  orderedList: (e) => e.isActive('orderedList'),
  blockquote: (e) => e.isActive('blockquote'),
}

interface RteToggleButtonProps {
  command: RichTextEditorFormatCommand
  'aria-label'?: string
  tooltip?: string
  children?: ReactNode
  className?: string
}

function RteToggleButton({ command, tooltip, children, className, ...props }: RteToggleButtonProps) {
  const { editor } = useContext(RteContext)
  const isActive = editor ? activeCheck[command]?.(editor) : false

  const button = (
    <Button
      data-slot="rich-text-editor-toggle-button"
      variant={isActive ? 'secondary' : 'ghost'}

      size="small"
      onClick={() => editor && commandMap[command]?.(editor)}
      className={cx('size-7', className)}
      aria-label={props['aria-label']}
      aria-pressed={isActive}
    >
      {children}
    </Button>
  )

  if (!tooltip) return button
  return (
    <TooltipTrigger delay={0}>
      {button}
      <Tooltip>{tooltip}</Tooltip>
    </TooltipTrigger>
  )
}

interface RteActionButtonProps {
  action: 'undo' | 'redo'
  'aria-label'?: string
  tooltip?: string
  children?: ReactNode
  className?: string
}

function RteActionButton({ action, tooltip, children, className, ...props }: RteActionButtonProps) {
  const { editor } = useContext(RteContext)
  const canDo = editor ? (action === 'undo' ? editor.can().undo() : editor.can().redo()) : false

  const button = (
    <Button
      data-slot="rich-text-editor-action-button"
      variant="ghost"

      size="small"
      disabled={!canDo}
      onClick={() =>
        editor && (action === 'undo' ? editor.chain().focus().undo().run() : editor.chain().focus().redo().run())
      }
      className={cx('size-7', className)}
      aria-label={props['aria-label']}
    >
      {children}
    </Button>
  )

  if (!tooltip) return button
  return (
    <TooltipTrigger delay={0}>
      {button}
      <Tooltip>{tooltip}</Tooltip>
    </TooltipTrigger>
  )
}

interface RteCommandButtonProps {
  'aria-label'?: string
  tooltip?: string
  disabled?: boolean | ((editor: Editor) => boolean)
  onCommand?: (editor: Editor) => void
  children?: ReactNode
  className?: string
}

function RteCommandButton({
  tooltip,
  disabled: disabledProp,
  onCommand,
  children,
  className,
  ...props
}: RteCommandButtonProps) {
  const { editor } = useContext(RteContext)
  const isOff = typeof disabledProp === 'function' ? (editor ? disabledProp(editor) : true) : disabledProp

  const button = (
    <Button
      data-slot="rich-text-editor-command-button"
      variant="ghost"

      size="small"
      disabled={isOff}
      onClick={() => editor && onCommand?.(editor)}
      className={cx('size-7', className)}
      aria-label={props['aria-label']}
    >
      {children}
    </Button>
  )

  if (!tooltip) return button
  return (
    <TooltipTrigger delay={0}>
      {button}
      <Tooltip>{tooltip}</Tooltip>
    </TooltipTrigger>
  )
}

function RteLinkPopoverRoot({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

function RteLinkPopoverTrigger({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="rich-text-editor-link-trigger" {...props} className={cx('', className)}>
      {children}
    </div>
  )
}

function RteLinkPopoverContent({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="rich-text-editor-link-content"
      {...props}
      className={cx(
        'flex items-center gap-1 rounded-lg border border-border-button-default bg-background-primary-default p-2 shadow-dropdown',
        className,
      )}
    >
      {children}
    </div>
  )
}

function RteLinkPopoverInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="rich-text-editor-link-input"
      type="url"
      {...props}
      className={cx('flex-1 bg-transparent text-sm outline-none placeholder:text-text-placeholder', className)}
    />
  )
}

function RteLinkPopoverActions({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="rich-text-editor-link-actions" {...props} className={cx('flex items-center gap-1', className)}>
      {children}
    </div>
  )
}

function RteLinkPopoverUnsetButton({
  children,
  className,
  ...props
}: ComponentProps<'button'> & { 'aria-label'?: string }) {
  return (
    <Button
      data-slot="rich-text-editor-link-unset"
      variant="ghost"
      size="small"
      className={cx('', className)}
      aria-label={props['aria-label']}
    >
      {children}
    </Button>
  )
}

function RteLinkPopoverApplyButton({
  children,
  className,
  ...props
}: ComponentProps<'button'> & { 'aria-label'?: string }) {
  return (
    <Button
      data-slot="rich-text-editor-link-apply"
      variant="primary"
      size="small"
      className={cx('', className)}
      aria-label={props['aria-label']}
    >
      {children}
    </Button>
  )
}

const RteLinkPopover = Object.assign(RteLinkPopoverRoot, {
  Trigger: RteLinkPopoverTrigger,
  Content: RteLinkPopoverContent,
  Input: RteLinkPopoverInput,
  Actions: RteLinkPopoverActions,
  UnsetButton: RteLinkPopoverUnsetButton,
  ApplyButton: RteLinkPopoverApplyButton,
})

function RteContent({ className, ...props }: ComponentProps<'div'>) {
  const { editor } = useContext(RteContext)
  if (!editor) return null
  return (
    <div
      data-slot="rich-text-editor-content"
      {...props}
      className={cx('rich-text-editor__prosemirror prose prose-sm max-w-none dark:prose-invert', className)}
    >
      <EditorContent editor={editor} />
    </div>
  )
}

function RteBubbleMenu({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="rich-text-editor-bubble-menu"
      {...props}
      className={cx(
        'flex items-center gap-0.5 rounded-lg border border-border-button-default bg-background-primary-default p-1 shadow-dropdown',
        className,
      )}
    >
      {children}
    </div>
  )
}

export const RichTextEditor = Object.assign(RichTextEditorRoot, {
  Shell: RteShell,
  Toolbar: RteToolbar,
  ToolbarGroup: RteToolbarGroup,
  ToolbarSeparator: RteToolbarSeparator,
  ToggleButton: RteToggleButton,
  ActionButton: RteActionButton,
  CommandButton: RteCommandButton,
  LinkPopover: RteLinkPopover,
  Content: RteContent,
  BubbleMenu: RteBubbleMenu,
})
