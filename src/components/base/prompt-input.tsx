import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cx } from '@/utils/cx'
import { Button } from './buttons/button'

type PromptInputStatus = 'ready' | 'submitted' | 'streaming'

interface PromptInputContext {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onStop?: () => void
  status: PromptInputStatus
  disabled?: boolean
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
  disabled?: boolean
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
  disabled,
  lockInputOnRun: _lockInputOnRun,
  allowSubmitWhileRunning: _allowSubmitWhileRunning,
  maxHeight: _maxHeight,
  ...props
}: PromptInputProps) {
  return (
    <PromptInputCtx.Provider value={{ value, onValueChange, onSubmit, onStop, status, disabled }}>
      <div data-slot="prompt-input" data-status={status} {...props} className={cx('flex flex-col', className)} />
    </PromptInputCtx.Provider>
  )
}

function PromptInputShell({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-shell"
      {...props}
      className={cx(
        'rounded-2xl border border-border-button-default bg-background-primary-default shadow-xs',
        className,
      )}
    />
  )
}

function PromptInputContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-input-content" {...props} className={cx('flex flex-col', className)} />
}

function PromptInputAttachments({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="prompt-input-attachments" {...props} className={cx('flex flex-wrap gap-1 px-3 pt-2', className)} />
  )
}

interface PromptInputTextAreaProps extends Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> {
  autoFocus?: boolean
}

function PromptInputTextArea({ className, ...props }: PromptInputTextAreaProps) {
  const { value, onValueChange, onSubmit, disabled } = useContext(PromptInputCtx)
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
      disabled={disabled}
      rows={1}
      {...props}
      className={cx(
        'w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-text-placeholder',
        className,
      )}
    />
  )
}

function PromptInputToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="prompt-input-toolbar" {...props} className={cx('flex items-center gap-1 px-2 pb-2', className)} />
  )
}

function PromptInputToolbarStart({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="prompt-input-toolbar-start" {...props} className={cx('flex items-center gap-1', className)} />
}

function PromptInputToolbarEnd({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="prompt-input-toolbar-end" {...props} className={cx('ml-auto flex items-center gap-1', className)} />
  )
}

interface PromptInputActionProps {
  'aria-label'?: string
  tooltip?: string
  onClick?: () => void
  className?: string
  children?: ReactNode
}

function PromptInputAction({ className, onClick, children, ...props }: PromptInputActionProps) {
  return (
    <Button
      data-slot="prompt-input-action"
      variant="ghost"
      iconOnly
      size="small"
      onClick={onClick}
      className={cx('text-text-secondary', className)}
      aria-label={props['aria-label']}
    >
      {children}
    </Button>
  )
}

interface PromptInputSendProps {
  'aria-label'?: string
  disabled?: boolean
  className?: string
}

function PromptInputSend({ className, disabled, ...props }: PromptInputSendProps) {
  const { onSubmit, onStop, status } = useContext(PromptInputCtx)
  const isRunning = status === 'submitted' || status === 'streaming'

  return (
    <Button
      data-slot="prompt-input-send"
      variant="primary"
      iconOnly
      size="small"
      disabled={disabled}
      onClick={isRunning ? onStop : onSubmit}
      className={cx('', className)}
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
  return (
    <div
      data-slot="prompt-input-footer"
      {...props}
      className={cx('px-3 pb-2 text-xs text-text-secondary', className)}
    />
  )
}

interface QueueRootProps extends ComponentProps<'div'> {
  actionsVisibility?: string
}

function QueueRoot({ className, actionsVisibility: _actionsVisibility, ...props }: QueueRootProps) {
  return <div data-slot="prompt-input-queue" {...props} className={cx('', className)} />
}

interface QueueListProps extends ComponentProps<'div'> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- consumer passes typed array
  values?: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- consumer passes typed callback
  onReorder?: (values: any[]) => void
}

function QueueList({ className, values: _values, onReorder: _onReorder, ...props }: QueueListProps) {
  return <div data-slot="prompt-input-queue-list" {...props} className={cx('flex flex-col gap-1 p-2', className)} />
}

interface QueueItemProps extends ComponentProps<'div'> {
  value?: unknown
  actionsVisibility?: string
}

interface QueueItemSteerProps extends ComponentProps<'button'> {
  onClick?: () => void
}

function QueueItemSteer({ className, onClick, ...props }: QueueItemSteerProps) {
  return (
    <button
      data-slot="prompt-input-queue-item-steer"
      type="button"
      onClick={onClick}
      {...props}
      className={cx('text-xs text-text-secondary hover:text-text-primary', className)}
    />
  )
}

function QueueItemRoot({ className, value: _value, actionsVisibility: _actionsVisibility, ...props }: QueueItemProps) {
  return (
    <div
      data-slot="prompt-input-queue-item"
      {...props}
      className={cx(
        'flex items-center gap-2 rounded-lg border border-border-button-default bg-background-primary-default p-2',
        className,
      )}
    />
  )
}

function QueueItemHandle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-handle"
      {...props}
      className={cx('cursor-grab text-text-secondary', className)}
    />
  )
}

function QueueItemBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-body"
      {...props}
      className={cx('flex min-w-0 flex-1 items-center gap-2', className)}
    />
  )
}

function QueueItemIcon({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-icon"
      {...props}
      className={cx('shrink-0 text-text-secondary', className)}
    />
  )
}

function QueueItemContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-content"
      {...props}
      className={cx('min-w-0 flex-1 truncate text-sm', className)}
    />
  )
}

function QueueItemDescription({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="prompt-input-queue-item-description"
      {...props}
      className={cx('text-xs text-text-secondary', className)}
    />
  )
}

function QueueItemActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-actions"
      {...props}
      className={cx('flex shrink-0 items-center gap-1', className)}
    />
  )
}

interface QueueItemActionProps {
  disabled?: boolean
  onClick?: () => void
  className?: string
  children?: ReactNode
  'aria-label'?: string
}

function QueueItemAction({ className, onClick, disabled, children, ...props }: QueueItemActionProps) {
  return (
    <Button
      data-slot="prompt-input-queue-item-action"
      variant="ghost"
      iconOnly
      size="small"
      disabled={disabled}
      onClick={onClick}
      className={cx('size-6 text-text-secondary', className)}
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
