import './plan-tiptap.css'
import { useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Dialog, DialogTrigger } from 'react-aria-components'
import type { Extension } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extensions'
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
  type UseEditorOptions,
} from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'

import { Button, type ButtonProps } from '@/components/yuerchu-ui/components/button/button'
import { Popover } from '@/components/yuerchu-ui/components/popover/popover'
import { Separator } from '@/components/yuerchu-ui/components/separator/separator'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'

import { PlanTiptapContext } from './plan-tiptap-context'

export type PlanTiptapFormatCommand =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'

function joinClasses(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ')
}

interface PlanTiptapRootProps extends Omit<ComponentProps<'div'>, 'defaultValue'> {
  defaultValue?: JSONContent
  extensions?: Extension[]
  editorProps?: UseEditorOptions['editorProps']
  isReadOnly?: boolean
  placeholder?: string
  onValueChange?: (document: JSONContent, details: { editor: Editor }) => void
}

export function PlanTiptap({
  className,
  defaultValue,
  extensions: userExtensions = [],
  editorProps = {},
  isReadOnly = false,
  placeholder: placeholderText,
  onValueChange,
  children,
  ...props
}: PlanTiptapRootProps) {
  const onValueChangeRef = useRef(onValueChange)
  onValueChangeRef.current = onValueChange

  const allExtensions = useMemo(
    () => [
      // StarterKit v3 bundles Link and Underline; disable both here so Link has
      // openOnClick: false without duplicate-extension warnings and Underline
      // cannot enter the document schema.
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        underline: false,
      }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholderText }),
      ...userExtensions,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extensions are stable per mount
    [placeholderText],
  )

  const editor = useEditor({
    extensions: allExtensions,
    content: defaultValue,
    editable: !isReadOnly,
    editorProps,
    onUpdate: ({ editor: instance }) => {
      onValueChangeRef.current?.(instance.getJSON(), { editor: instance })
    },
  })

  useEffect(() => {
    if (editor && editor.isEditable !== !isReadOnly) {
      editor.setEditable(!isReadOnly)
    }
  }, [editor, isReadOnly])

  return (
    <PlanTiptapContext.Provider value={{ editor }}>
      <div data-slot="plan-tiptap" {...props} className={joinClasses('m-plan-review-editor', className)}>
        {children}
      </div>
    </PlanTiptapContext.Provider>
  )
}

export function PlanTiptapShell({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="plan-tiptap-shell" {...props} className={joinClasses('m-plan-review-editor__shell', className)} />
  )
}

export function PlanTiptapToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="plan-tiptap-toolbar"
      role="toolbar"
      {...props}
      className={joinClasses('m-plan-review-editor__toolbar', className)}
    />
  )
}

export function PlanTiptapToolbarGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="plan-tiptap-toolbar-group"
      {...props}
      className={joinClasses('m-plan-review-editor__toolbar-group', className)}
    />
  )
}

export function PlanTiptapToolbarSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="plan-tiptap-toolbar-separator"
      {...props}
      className={joinClasses('m-plan-review-editor__toolbar-separator', className)}
    >
      <Separator orientation="vertical" />
    </div>
  )
}

const commandMap: Record<PlanTiptapFormatCommand, (editor: Editor) => void> = {
  'heading-1': (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  'heading-2': (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  'heading-3': (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  bold: (e) => e.chain().focus().toggleBold().run(),
  italic: (e) => e.chain().focus().toggleItalic().run(),
  strike: (e) => e.chain().focus().toggleStrike().run(),
  code: (e) => e.chain().focus().toggleCode().run(),
  codeBlock: (e) => e.chain().focus().toggleCodeBlock().run(),
  bulletList: (e) => e.chain().focus().toggleBulletList().run(),
  orderedList: (e) => e.chain().focus().toggleOrderedList().run(),
  blockquote: (e) => e.chain().focus().toggleBlockquote().run(),
}

const activeCheck: Record<PlanTiptapFormatCommand, (editor: Editor) => boolean> = {
  'heading-1': (e) => e.isActive('heading', { level: 1 }),
  'heading-2': (e) => e.isActive('heading', { level: 2 }),
  'heading-3': (e) => e.isActive('heading', { level: 3 }),
  bold: (e) => e.isActive('bold'),
  italic: (e) => e.isActive('italic'),
  strike: (e) => e.isActive('strike'),
  code: (e) => e.isActive('code'),
  codeBlock: (e) => e.isActive('codeBlock'),
  bulletList: (e) => e.isActive('bulletList'),
  orderedList: (e) => e.isActive('orderedList'),
  blockquote: (e) => e.isActive('blockquote'),
}

function WithTooltip({ tooltip, children }: { tooltip?: ReactNode; children: ReactNode }) {
  if (!tooltip) return <>{children}</>
  return (
    <TooltipTrigger>
      {children}
      <Tooltip>{tooltip}</Tooltip>
    </TooltipTrigger>
  )
}

interface PlanTiptapToggleButtonProps extends Omit<ButtonProps, 'variant' | 'size' | 'onPress' | 'children'> {
  command: PlanTiptapFormatCommand
  tooltip?: ReactNode
}

export function PlanTiptapToggleButton({ command, tooltip, ...props }: PlanTiptapToggleButtonProps) {
  const { editor } = useContext(PlanTiptapContext)
  const isActive =
    useEditorState({
      editor,
      selector: ({ editor: instance }) => (instance ? activeCheck[command](instance) : false),
    }) ?? false

  return (
    <WithTooltip tooltip={tooltip}>
      <Button
        data-slot="plan-tiptap-toggle-button"
        variant="ghost"
        size="sm"
        aria-pressed={isActive}
        data-active={isActive || undefined}
        isDisabled={!editor}
        onPress={() => editor && commandMap[command](editor)}
        {...props}
      />
    </WithTooltip>
  )
}

interface PlanTiptapActionButtonProps extends Omit<ButtonProps, 'variant' | 'size' | 'onPress' | 'children'> {
  action: 'undo' | 'redo'
  tooltip?: ReactNode
}

export function PlanTiptapActionButton({ action, tooltip, ...props }: PlanTiptapActionButtonProps) {
  const { editor } = useContext(PlanTiptapContext)
  const canDo =
    useEditorState({
      editor,
      selector: ({ editor: instance }) =>
        instance ? (action === 'undo' ? instance.can().undo() : instance.can().redo()) : false,
    }) ?? false

  return (
    <WithTooltip tooltip={tooltip}>
      <Button
        data-slot="plan-tiptap-action-button"
        variant="ghost"
        size="sm"
        isDisabled={!canDo}
        onPress={() =>
          editor && (action === 'undo' ? editor.chain().focus().undo().run() : editor.chain().focus().redo().run())
        }
        {...props}
      />
    </WithTooltip>
  )
}

interface PlanTiptapCommandButtonProps extends Omit<
  ButtonProps,
  'variant' | 'size' | 'onPress' | 'isDisabled' | 'children'
> {
  tooltip?: ReactNode
  /** A boolean, or a predicate on the editor re-evaluated per transaction. */
  disabled?: boolean | ((editor: Editor) => boolean)
  onCommand?: (editor: Editor) => void
}

export function PlanTiptapCommandButton({ tooltip, disabled, onCommand, ...props }: PlanTiptapCommandButtonProps) {
  const { editor } = useContext(PlanTiptapContext)
  const isOff =
    useEditorState({
      editor,
      selector: ({ editor: instance }) => {
        if (!instance) return true
        return typeof disabled === 'function' ? disabled(instance) : Boolean(disabled)
      },
    }) ?? true

  return (
    <WithTooltip tooltip={tooltip}>
      <Button
        data-slot="plan-tiptap-command-button"
        variant="ghost"
        size="sm"
        isDisabled={isOff}
        onPress={() => editor && onCommand?.(editor)}
        {...props}
      />
    </WithTooltip>
  )
}

interface PlanTiptapLinkPopoverProps {
  label: string
  urlLabel: string
  removeLabel: string
  applyLabel: string
  icon: ReactNode
}

export function PlanTiptapLinkPopover({ label, urlLabel, removeLabel, applyLabel, icon }: PlanTiptapLinkPopoverProps) {
  const { editor } = useContext(PlanTiptapContext)
  const [isOpen, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const isActive =
    useEditorState({
      editor,
      selector: ({ editor: instance }) => (instance ? instance.isActive('link') : false),
    }) ?? false

  const close = () => setOpen(false)
  const apply = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    editor?.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
    close()
  }

  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) setUrl(String(editor?.getAttributes('link').href ?? ''))
        setOpen(open)
      }}
    >
      <TooltipTrigger>
        <Button
          data-slot="plan-tiptap-link-trigger"
          variant="ghost"
          size="sm"
          icon={icon}
          aria-label={label}
          aria-pressed={isActive}
          data-active={isActive || undefined}
          isDisabled={!editor}
        />
        <Tooltip>{label}</Tooltip>
      </TooltipTrigger>
      <Popover placement="bottom start" offset={6}>
        <Dialog data-slot="plan-tiptap-link-content" aria-label={label}>
          <div className="m-plan-review-editor__link-row">
            <div className="m-plan-review-editor__link-input">
              <TextField
                aria-label={urlLabel}
                type="url"
                size="sm"
                placeholder="https://"
                autoFocus
                value={url}
                onChange={setUrl}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    apply()
                  }
                }}
              />
            </div>
            <div data-slot="plan-tiptap-link-actions" className="m-plan-review-editor__link-actions">
              <Button
                data-slot="plan-tiptap-link-unset"
                variant="secondary"
                size="sm"
                onPress={() => {
                  editor?.chain().focus().extendMarkRange('link').unsetLink().run()
                  close()
                }}
              >
                {removeLabel}
              </Button>
              <Button
                data-slot="plan-tiptap-link-apply"
                variant="primary"
                size="sm"
                isDisabled={!url.trim()}
                onPress={apply}
              >
                {applyLabel}
              </Button>
            </div>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}

export function PlanTiptapContent({ className, ...props }: ComponentProps<'div'>) {
  const { editor } = useContext(PlanTiptapContext)
  if (!editor) return null
  return (
    <div data-slot="plan-tiptap-content" {...props} className={joinClasses('m-plan-review-editor__content', className)}>
      <EditorContent editor={editor} />
    </div>
  )
}

export function PlanTiptapBubbleMenu({ children, className, ...props }: ComponentProps<'div'>) {
  const { editor } = useContext(PlanTiptapContext)
  if (!editor) return null
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top' }}
      role="toolbar"
      data-slot="plan-tiptap-bubble-menu"
      {...props}
      className={joinClasses('m-plan-review-editor__bubble-menu', className)}
    >
      {children}
    </BubbleMenu>
  )
}
