import { createContext, useContext, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import type { Extension } from '@tiptap/core'
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Input as AriaInput,
  Popover as AriaPopover,
  type ButtonProps as AriaButtonProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { Button, type ButtonProps } from './buttons/button'
import { OVERLAY_MOTION, OVERLAY_SURFACE } from './overlay-motion'
import { Tooltip, TooltipTrigger } from './tooltip/tooltip'

/**
 * A Tiptap editor with a boardui toolbar. The plan-review page is its one
 * caller; it renders the toolbar itself from these parts so the set of
 * commands is the page's decision.
 *
 * Toolbar state is read through `useEditorState`: Tiptap v3 does not
 * re-render React on a transaction, so a button reading `editor.isActive()`
 * directly shows the state of the last render, not of the selection.
 *
 * The link popover is a React Aria `DialogTrigger`: it opens from a RAC button
 * with the current link pre-filled, applies or removes the link on the
 * selection, and closes itself.
 */

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
  editorOptions,
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
    ...editorOptions,
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
        'rich-text-editor__shell overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default',
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
        'rich-text-editor__toolbar flex items-center gap-0.5 border-b border-border-button-default px-2 py-1',
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
      aria-hidden
      {...props}
      className={cx('mx-1 h-5 w-px bg-border-button-default', className)}
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

/** Wraps a toolbar button in its tooltip when it has one. */
function WithTooltip({ tooltip, children }: { tooltip?: ReactNode; children: ReactNode }) {
  if (!tooltip) return <>{children}</>
  return (
    <TooltipTrigger delay={0}>
      {children}
      <Tooltip>{tooltip}</Tooltip>
    </TooltipTrigger>
  )
}

interface RteToggleButtonProps extends Omit<ButtonProps, 'variant' | 'size' | 'onPress'> {
  command: RichTextEditorFormatCommand
  tooltip?: ReactNode
}

function RteToggleButton({ command, tooltip, children, className, ...props }: RteToggleButtonProps) {
  const { editor } = useContext(RteContext)
  const isActive =
    useEditorState({
      editor,
      selector: ({ editor: e }) => (e ? activeCheck[command](e) : false),
    }) ?? false
  return (
    <WithTooltip tooltip={tooltip}>
      <Button
        data-slot="rich-text-editor-toggle-button"
        variant={isActive ? 'tertiary' : 'ghost'}
        size="small"
        iconOnly
        aria-pressed={isActive}
        isDisabled={!editor}
        onPress={() => editor && commandMap[command](editor)}
        {...props}
        className={cx('size-7', className)}
      >
        {children}
      </Button>
    </WithTooltip>
  )
}

interface RteActionButtonProps extends Omit<ButtonProps, 'variant' | 'size' | 'onPress'> {
  action: 'undo' | 'redo'
  tooltip?: ReactNode
}

function RteActionButton({ action, tooltip, children, className, ...props }: RteActionButtonProps) {
  const { editor } = useContext(RteContext)
  const canDo =
    useEditorState({
      editor,
      selector: ({ editor: e }) => (e ? (action === 'undo' ? e.can().undo() : e.can().redo()) : false),
    }) ?? false
  return (
    <WithTooltip tooltip={tooltip}>
      <Button
        data-slot="rich-text-editor-action-button"
        variant="ghost"
        size="small"
        iconOnly
        isDisabled={!canDo}
        onPress={() =>
          editor && (action === 'undo' ? editor.chain().focus().undo().run() : editor.chain().focus().redo().run())
        }
        {...props}
        className={cx('size-7', className)}
      >
        {children}
      </Button>
    </WithTooltip>
  )
}

interface RteCommandButtonProps extends Omit<ButtonProps, 'variant' | 'size' | 'onPress' | 'isDisabled'> {
  tooltip?: ReactNode
  /** A boolean, or a predicate on the editor re-evaluated per transaction. */
  disabled?: boolean | ((editor: Editor) => boolean)
  onCommand?: (editor: Editor) => void
}

function RteCommandButton({ tooltip, disabled, onCommand, children, className, ...props }: RteCommandButtonProps) {
  const { editor } = useContext(RteContext)
  const isOff =
    useEditorState({
      editor,
      selector: ({ editor: e }) => {
        if (!e) return true
        return typeof disabled === 'function' ? disabled(e) : Boolean(disabled)
      },
    }) ?? true
  return (
    <WithTooltip tooltip={tooltip}>
      <Button
        data-slot="rich-text-editor-command-button"
        variant="ghost"
        size="small"
        iconOnly
        isDisabled={isOff}
        onPress={() => editor && onCommand?.(editor)}
        {...props}
        className={cx('size-7', className)}
      >
        {children}
      </Button>
    </WithTooltip>
  )
}

/* ------------------------------------------------------------ link popover */

interface LinkPopoverContextValue {
  url: string
  setUrl: (url: string) => void
  close: () => void
}

const LinkPopoverContext = createContext<LinkPopoverContextValue>({ url: '', setUrl: () => {}, close: () => {} })

function RteLinkPopoverRoot({ children }: { children?: ReactNode }) {
  const { editor } = useContext(RteContext)
  const [isOpen, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  return (
    <LinkPopoverContext.Provider value={{ url, setUrl, close: () => setOpen(false) }}>
      <DialogTrigger
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (open) setUrl(String(editor?.getAttributes('link').href ?? ''))
          setOpen(open)
        }}
      >
        {children}
      </DialogTrigger>
    </LinkPopoverContext.Provider>
  )
}

interface RteLinkPopoverTriggerProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  className?: string
  children?: ReactNode
}

function RteLinkPopoverTrigger({ children, className, ...props }: RteLinkPopoverTriggerProps) {
  const { editor } = useContext(RteContext)
  const isActive = useEditorState({ editor, selector: ({ editor: e }) => (e ? e.isActive('link') : false) }) ?? false
  return (
    <Button
      data-slot="rich-text-editor-link-trigger"
      variant={isActive ? 'tertiary' : 'ghost'}
      size="small"
      iconOnly
      aria-pressed={isActive}
      isDisabled={!editor}
      {...props}
      className={cx('size-7', className)}
    >
      {children}
    </Button>
  )
}

function RteLinkPopoverContent({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <AriaPopover
      data-slot="rich-text-editor-link-popover"
      placement="bottom start"
      offset={6}
      className={cx('w-80 p-2', OVERLAY_SURFACE, OVERLAY_MOTION, className)}
    >
      <Dialog
        data-slot="rich-text-editor-link-content"
        aria-label="Link"
        className="flex items-center gap-2 outline-none"
      >
        {children}
      </Dialog>
    </AriaPopover>
  )
}

function RteLinkPopoverInput({
  className,
  ...props
}: Omit<ComponentProps<typeof AriaInput>, 'value' | 'onChange' | 'className'> & { className?: string }) {
  const { url, setUrl } = useContext(LinkPopoverContext)
  return (
    <AriaInput
      data-slot="rich-text-editor-link-input"
      type="url"
      autoFocus
      value={url}
      onChange={(e) => setUrl(e.target.value)}
      placeholder="https://"
      {...props}
      className={cx(
        'min-w-0 flex-1 rounded-lg bg-background-tertiary-default px-2 py-1.5 text-body-regular text-text-primary outline-none',
        'placeholder:text-text-tertiary focus:ring-2 focus:ring-inset focus:ring-border-button-active',
        className,
      )}
    />
  )
}

function RteLinkPopoverActions({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="rich-text-editor-link-actions"
      {...props}
      className={cx('flex shrink-0 items-center gap-1', className)}
    >
      {children}
    </div>
  )
}

function RteLinkPopoverUnsetButton({
  children,
  className,
  ...props
}: Omit<ButtonProps, 'variant' | 'size' | 'onPress'>) {
  const { editor } = useContext(RteContext)
  const { close } = useContext(LinkPopoverContext)
  return (
    <Button
      data-slot="rich-text-editor-link-unset"
      variant="ghost"
      size="small"
      onPress={() => {
        editor?.chain().focus().extendMarkRange('link').unsetLink().run()
        close()
      }}
      {...props}
      className={cx(className)}
    >
      {children}
    </Button>
  )
}

function RteLinkPopoverApplyButton({
  children,
  className,
  ...props
}: Omit<ButtonProps, 'variant' | 'size' | 'onPress'>) {
  const { editor } = useContext(RteContext)
  const { url, close } = useContext(LinkPopoverContext)
  return (
    <Button
      data-slot="rich-text-editor-link-apply"
      variant="primary"
      size="small"
      isDisabled={!url.trim()}
      onPress={() => {
        editor?.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
        close()
      }}
      {...props}
      className={cx(className)}
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

/**
 * The toolbar that appears beside a non-empty selection.
 *
 * Tiptap's own `BubbleMenu`: the plugin shows and positions the element off
 * the editor's selection and hides it otherwise. It used to be an ordinary
 * in-flow `div`, always visible at the bottom of the editor.
 */
function RteBubbleMenu({ children, className, ...props }: ComponentProps<'div'>) {
  const { editor } = useContext(RteContext)
  if (!editor) return null
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top' }}
      data-slot="rich-text-editor-bubble-menu"
      {...props}
      className={cx('z-50 flex items-center gap-0.5 p-1', OVERLAY_SURFACE, className)}
    >
      {children}
    </BubbleMenu>
  )
}

/** A bare RAC button for a toolbar slot that is none of the above. */
export function RteToolbarButton(props: AriaButtonProps) {
  return <AriaButton {...props} />
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
