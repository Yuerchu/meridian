import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

type PromptInputStatus = 'ready' | 'submitted' | 'streaming'

interface PromptInputContext {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onStop?: () => void
  status: PromptInputStatus
  isDisabled?: boolean
}

const PromptInputCtx = createContext<PromptInputContext>({
  value: '',
  onValueChange: () => {},
  onSubmit: () => {},
  status: 'ready',
})

interface PromptInputProps extends Omit<ComponentProps<'div'>, 'onSubmit'> {
  value?: string
  onValueChange?: (value: string) => void
  onSubmit?: () => void
  onStop?: () => void
  status?: PromptInputStatus
  isDisabled?: boolean
  lockInputOnRun?: boolean
  allowSubmitWhileRunning?: boolean
  maxHeight?: number
}

function PromptInputRoot({
  className,
  value = '',
  onValueChange = () => {},
  onSubmit = () => {},
  onStop,
  status = 'ready',
  isDisabled,
  lockInputOnRun: _lockInputOnRun,
  allowSubmitWhileRunning: _allowSubmitWhileRunning,
  maxHeight: _maxHeight,
  ...props
}: PromptInputProps) {
  return (
    <PromptInputCtx.Provider value={{ value, onValueChange, onSubmit, onStop, status, isDisabled }}>
      <div data-slot="prompt-input" data-status={status} {...props} className={cn('flex flex-col', className)} />
    </PromptInputCtx.Provider>
  )
}

function PromptInputShell({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-shell"
      {...props}
      className={cn('rounded-2xl border border-field-border bg-field shadow-field', className)}
    />
  )
}

function PromptInputContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-input-content" {...props} className={cn('flex flex-col', className)} />
}

function PromptInputAttachments({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="prompt-input-attachments" {...props} className={cn('flex flex-wrap gap-1 px-3 pt-2', className)} />
  )
}

interface PromptInputTextAreaProps extends Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> {
  autoFocus?: boolean
}

function PromptInputTextArea({ className, ...props }: PromptInputTextAreaProps) {
  const { value, onValueChange, onSubmit, isDisabled } = useContext(PromptInputCtx)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        onSubmit()
      }
    },
    [onSubmit],
  )

  return (
    <textarea
      ref={textareaRef}
      data-slot="prompt-input-textarea"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={handleKeyDown}
      disabled={isDisabled}
      rows={1}
      {...props}
      className={cn(
        'w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-field-placeholder',
        className,
      )}
    />
  )
}

function PromptInputToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="prompt-input-toolbar" {...props} className={cn('flex items-center gap-1 px-2 pb-2', className)} />
  )
}

function PromptInputToolbarStart({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-input-toolbar-start" {...props} className={cn('flex items-center gap-1', className)} />
}

function PromptInputToolbarEnd({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="prompt-input-toolbar-end" {...props} className={cn('ml-auto flex items-center gap-1', className)} />
  )
}

interface PromptInputActionProps {
  'aria-label'?: string
  tooltip?: string
  onPress?: () => void
  className?: string
  children?: ReactNode
}

function PromptInputAction({ className, onPress, children, ...props }: PromptInputActionProps) {
  return (
    // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- caller supplies tooltip
    <Button
      data-slot="prompt-input-action"
      variant="ghost"
      isIconOnly
      size="sm"
      onPress={onPress}
      className={cn('text-muted', className)}
      aria-label={props['aria-label']}
    >
      {children}
    </Button>
  )
}

interface PromptInputSendProps {
  'aria-label'?: string
  isDisabled?: boolean
  className?: string
}

function PromptInputSend({ className, isDisabled, ...props }: PromptInputSendProps) {
  const { onSubmit, onStop, status } = useContext(PromptInputCtx)
  const isRunning = status === 'submitted' || status === 'streaming'

  return (
    // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- send button has aria-label
    <Button
      data-slot="prompt-input-send"
      variant="primary"
      isIconOnly
      size="sm"
      isDisabled={isDisabled}
      onPress={isRunning ? onStop : onSubmit}
      className={cn('', className)}
      aria-label={props['aria-label']}
    >
      {isRunning ? (
        <svg data-slot="prompt-input-stop-icon" className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <rect x="4" y="4" width="8" height="8" rx="1" />
        </svg>
      ) : (
        <svg data-slot="prompt-input-send-icon" className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.5 13.5l9-5.5-9-5.5v4l5 1.5-5 1.5z" />
        </svg>
      )}
    </Button>
  )
}

function PromptInputFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-input-footer" {...props} className={cn('px-3 pb-2 text-xs text-muted', className)} />
}

interface QueueRootProps extends ComponentProps<'div'> {
  actionsVisibility?: string
}

function QueueRoot({ className, actionsVisibility: _actionsVisibility, ...props }: QueueRootProps) {
  return <div data-slot="prompt-input-queue" {...props} className={cn('', className)} />
}

interface QueueListProps extends ComponentProps<'div'> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- consumer passes typed array
  values?: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- consumer passes typed callback
  onReorder?: (values: any[]) => void
}

function QueueList({ className, values: _values, onReorder: _onReorder, ...props }: QueueListProps) {
  return <div data-slot="prompt-input-queue-list" {...props} className={cn('flex flex-col gap-1 p-2', className)} />
}

interface QueueItemProps extends ComponentProps<'div'> {
  value?: unknown
  actionsVisibility?: string
}

interface QueueItemSteerProps extends ComponentProps<'button'> {
  onPress?: () => void
}

function QueueItemSteer({ className, onPress, ...props }: QueueItemSteerProps) {
  return (
    <button
      data-slot="prompt-input-queue-item-steer"
      type="button"
      onClick={onPress}
      {...props}
      className={cn('text-xs text-muted hover:text-foreground', className)}
    />
  )
}

function QueueItemRoot({ className, value: _value, actionsVisibility: _actionsVisibility, ...props }: QueueItemProps) {
  return (
    <div
      data-slot="prompt-input-queue-item"
      {...props}
      className={cn('flex items-center gap-2 rounded-lg border border-border bg-surface p-2', className)}
    />
  )
}

function QueueItemHandle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="prompt-input-queue-item-handle" {...props} className={cn('cursor-grab text-muted', className)} />
  )
}

function QueueItemBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-body"
      {...props}
      className={cn('flex min-w-0 flex-1 items-center gap-2', className)}
    />
  )
}

function QueueItemIcon({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-input-queue-item-icon" {...props} className={cn('shrink-0 text-muted', className)} />
}

function QueueItemContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-content"
      {...props}
      className={cn('min-w-0 flex-1 truncate text-sm', className)}
    />
  )
}

function QueueItemDescription({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="prompt-input-queue-item-description" {...props} className={cn('text-xs text-muted', className)} />
  )
}

function QueueItemActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-actions"
      {...props}
      className={cn('flex shrink-0 items-center gap-1', className)}
    />
  )
}

interface QueueItemActionProps {
  isDisabled?: boolean
  onPress?: () => void
  className?: string
  children?: ReactNode
  'aria-label'?: string
}

function QueueItemAction({ className, onPress, isDisabled, children, ...props }: QueueItemActionProps) {
  return (
    // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- inline action
    <Button
      data-slot="prompt-input-queue-item-action"
      variant="ghost"
      isIconOnly
      size="sm"
      isDisabled={isDisabled}
      onPress={onPress}
      className={cn('size-6 text-muted', className)}
      aria-label={props['aria-label']}
    >
      {children}
    </Button>
  )
}

const QueueItem = Object.assign(QueueItemRoot, {
  Handle: QueueItemHandle,
  Steer: QueueItemSteer,
  Remove: QueueItemAction,
  Body: QueueItemBody,
  Icon: QueueItemIcon,
  Content: QueueItemContent,
  Description: QueueItemDescription,
  Actions: QueueItemActions,
  Action: QueueItemAction,
})

const Queue = Object.assign(QueueRoot, {
  List: QueueList,
  Item: QueueItem,
})

export const PromptInput = Object.assign(PromptInputRoot, {
  Shell: PromptInputShell,
  Content: PromptInputContent,
  Attachments: PromptInputAttachments,
  TextArea: PromptInputTextArea,
  Toolbar: PromptInputToolbar,
  ToolbarStart: PromptInputToolbarStart,
  ToolbarEnd: PromptInputToolbarEnd,
  Action: PromptInputAction,
  Send: PromptInputSend,
  Footer: PromptInputFooter,
  Queue,
})
