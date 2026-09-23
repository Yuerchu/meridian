import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Button as AriaButton,
  GridList,
  GridListItem,
  useDragAndDrop,
  type ButtonProps as AriaButtonProps,
  type GridListItemProps,
  type Key,
} from 'react-aria-components'
import { ArrowUp, X } from '@keyline-icons/react/two-tone'
import { Stop } from '@keyline-icons/react/fill'
import { cx } from '@/utils/cx'
import { Button, type ButtonProps } from './buttons/button'
import { Spinner } from './spinner'
import { Tooltip, TooltipTrigger } from './tooltip/tooltip'

/**
 * The chat composer's shell, until boardui Pro's `composer` replaces it: a
 * growing text area, a toolbar, a send/stop button, and the queue of prompts
 * waiting on the turn.
 *
 * The root holds the value and the turn's status and hands both down. Enter
 * submits unless the turn is running and `allowSubmitWhileRunning` is off;
 * `lockInputOnRun` makes the field read-only for the length of a turn;
 * `maxHeight` is the pixel ceiling the field grows to before it scrolls.
 *
 * `PromptInput.Queue.List` is a React Aria `GridList` with drag-and-drop
 * reordering over `values` / `onReorder`; `Queue.Item.Handle` is the tree's
 * `slot="drag"` button, the keyboard and screen-reader way to move a row.
 */

type PromptInputStatus = 'ready' | 'submitted' | 'streaming'

interface PromptInputContextValue {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onStop?: () => void
  status: PromptInputStatus
  disabled?: boolean
  lockInputOnRun: boolean
  allowSubmitWhileRunning: boolean
  maxHeight?: number
}

const PromptInputCtx = createContext<PromptInputContextValue>({
  value: '',
  onValueChange: () => {},
  onSubmit: () => {},
  status: 'ready',
  lockInputOnRun: true,
  allowSubmitWhileRunning: false,
})

const isRunning = (status: PromptInputStatus) => status === 'submitted' || status === 'streaming'

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
  lockInputOnRun = true,
  allowSubmitWhileRunning = false,
  maxHeight,
  ...props
}: PromptInputProps) {
  return (
    <PromptInputCtx.Provider
      value={{
        value,
        onValueChange,
        onSubmit,
        onStop,
        status,
        disabled,
        lockInputOnRun,
        allowSubmitWhileRunning,
        maxHeight,
      }}
    >
      <div data-slot="prompt-input" data-status={status} {...props} className={cx('flex flex-col', className)} />
    </PromptInputCtx.Provider>
  )
}

function PromptInputShell({ className, ...props }: ComponentProps<'div'>) {
  const { status } = useContext(PromptInputCtx)
  const running = isRunning(status)
  return (
    <div
      data-slot="prompt-input-shell"
      data-running={running || undefined}
      {...props}
      className={cx(
        'rounded-3xl border border-border-button-default bg-background-primary-default shadow-xs',
        'transition-[box-shadow,border-color] duration-150 focus-within:border-border-button-active',
        // boardui's composer-loader paints the pill surface itself and runs its
        // light between that surface and the content, so while a turn runs the
        // shell steps aside — the registry's agent-composer does the same with
        // `busy ? "bg-transparent" : "bg-background-primary-default shadow-xs"`.
        // The edge goes transparent rather than away, so nothing moves.
        running && 'border-transparent bg-transparent shadow-none focus-within:border-transparent',
        'data-[dragging=true]:border-dashed data-[dragging=true]:border-accent-500 data-[dragging=true]:bg-button-ghost-background',
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
    <div
      data-slot="prompt-input-attachments"
      {...props}
      className={cx('flex flex-wrap gap-1.5 px-3 pt-3', className)}
    />
  )
}

type PromptInputTextAreaProps = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'>

function PromptInputTextArea({ className, onKeyDown, ...props }: PromptInputTextAreaProps) {
  const { value, onValueChange, onSubmit, status, disabled, lockInputOnRun, allowSubmitWhileRunning, maxHeight } =
    useContext(PromptInputCtx)
  const ref = useRef<HTMLTextAreaElement>(null)
  const running = isRunning(status)

  // Grow to the content, up to `maxHeight`, then scroll.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const next = maxHeight ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight
    el.style.height = `${next}px`
    el.style.overflowY = maxHeight && el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, maxHeight])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(e)
      if (e.defaultPrevented) return
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        if (running && !allowSubmitWhileRunning) return
        onSubmit()
      }
    },
    [onKeyDown, onSubmit, running, allowSubmitWhileRunning],
  )

  return (
    <textarea
      ref={ref}
      data-slot="prompt-input-textarea"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      readOnly={running && lockInputOnRun}
      rows={1}
      {...props}
      className={cx(
        'w-full resize-none bg-transparent px-4 py-3 text-body-regular text-text-primary outline-none placeholder:text-text-tertiary',
        'disabled:cursor-not-allowed disabled:text-text-tertiary',
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

/**
 * A round control in the composer's toolbar (`+`, emoji, voice).
 *
 * The recipe is the registry's AI Chat starter
 * (`components/application/agent-chat/agent-composer.tsx`, the attachment
 * button): 36px, a full pill, the Pro composer's `ai-chat-composer-add-*`
 * tokens and primary icon ink. Upstream's note on those tokens: they resolve
 * one step lighter than the pill in dark and one step darker in light, so one
 * pair serves both themes. The element is React Aria's `Button` (the
 * interaction contract), so `hover:` is `data-[hovered]`, and a
 * `MenuTrigger`/`DialogTrigger`/`TooltipTrigger` reaches it through context.
 * `tone="danger"` is the recording microphone; `isPending` swaps the icon for
 * a spinner, the way `Button` does.
 */
const CONTROL = cx(
  'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full',
  'bg-ai-chat-composer-add-background text-foreground-icon-primary transition-colors duration-150 ease',
  'data-[hovered]:bg-ai-chat-composer-add-hover-background',
  // Disabled dims the whole control and keeps its ink, the way the registry's
  // AI Chat starter draws the icon controls it disables while a turn runs
  // (`agent-chat-actions.tsx`: `disabled:opacity-40`). `text-text-disabled` is
  // neutral-800 in dark — the pill's own colour — so on the neutral-700 chip
  // the microphone turned black the moment streaming disabled it.
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
  'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
)

const CONTROL_DANGER = 'bg-button-danger text-text-white data-[hovered]:bg-button-danger'

interface PromptInputControlProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  leadingIcon: ButtonProps['leadingIcon']
  tone?: 'default' | 'danger'
  className?: string
  ref?: Ref<HTMLButtonElement>
}

function PromptInputControl({
  leadingIcon: Icon,
  tone = 'default',
  isPending,
  className,
  ...props
}: PromptInputControlProps) {
  return (
    <AriaButton
      data-slot="prompt-input-control"
      isPending={isPending}
      {...props}
      className={cx(CONTROL, tone === 'danger' && CONTROL_DANGER, className)}
    >
      {isPending ? (
        <Spinner size="sm" color="current" />
      ) : Icon ? (
        <Icon aria-hidden className="size-5 shrink-0" />
      ) : null}
    </AriaButton>
  )
}

interface PromptInputActionProps extends Omit<ButtonProps, 'variant' | 'size' | 'iconOnly' | 'children'> {
  /** Shown on hover/focus; the `aria-label` remains the name. */
  tooltip?: ReactNode
}

/**
 * The toolbar's Stop, beside a Send that is steering. Grey, as the registry's
 * agent-composer draws its stop button (`size-9 rounded-full
 * bg-background-secondary-default text-foreground-icon-secondary`, hover one
 * step up) — which is `Button`'s `neutral` variant at `medium`.
 */
function PromptInputAction({ className, tooltip, ...props }: PromptInputActionProps) {
  const button = (
    // eslint-disable-next-line meridian-ui/icon-only-needs-name -- wrapper: the caller's aria-label arrives through {...props}
    <Button data-slot="prompt-input-action" variant="neutral" iconOnly size="medium" {...props} className={className} />
  )
  if (!tooltip) return button
  return (
    <TooltipTrigger delay={0}>
      {button}
      <Tooltip>{tooltip}</Tooltip>
    </TooltipTrigger>
  )
}

interface PromptInputSendProps {
  'aria-label'?: string
  disabled?: boolean
  className?: string
}

function PromptInputSend({ className, disabled, ...props }: PromptInputSendProps) {
  const { onSubmit, onStop, status } = useContext(PromptInputCtx)
  const running = isRunning(status)
  // Send is the primary pill; Stop is the registry agent-composer's grey one
  // (`bg-background-secondary-default text-foreground-icon-secondary`, which is
  // the `neutral` variant). Both 36px round, as upstream.
  const stopping = running && !!onStop
  return (
    <Button
      data-slot="prompt-input-send"
      data-running={running || undefined}
      variant={stopping ? 'neutral' : 'primary'}
      iconOnly
      size="medium"
      // `submitted` is the wait for the first token: a spinner, no press.
      // `streaming` is the stop button; without an onStop it is a wait too.
      isPending={status === 'submitted'}
      isDisabled={disabled || (running && !onStop)}
      onPress={running ? onStop : onSubmit}
      className={cx('rounded-full', className)}
      aria-label={props['aria-label']}
      leadingIcon={running ? Stop : ArrowUp}
    />
  )
}

function PromptInputFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-footer"
      {...props}
      className={cx('px-3 pb-2 text-caption-1-medium text-text-secondary', className)}
    />
  )
}

/* ------------------------------------------------------------------ queue */

interface QueueRootProps extends ComponentProps<'div'> {
  /** `hover` reveals a row's actions on hover/focus; `always` keeps them shown (touch). */
  actionsVisibility?: 'hover' | 'always'
}

function QueueRoot({ className, actionsVisibility = 'hover', ...props }: QueueRootProps) {
  return (
    <div
      data-slot="prompt-input-queue"
      data-actions={actionsVisibility}
      {...props}
      className={cx(
        'group/queue mb-2 rounded-2xl border border-border-button-default bg-background-secondary-default',
        className,
      )}
    />
  )
}

interface QueueValue {
  id: Key
}

interface QueueListProps<T extends QueueValue> {
  values?: T[]
  onReorder?: (values: T[]) => void
  'aria-label'?: string
  className?: string
  children?: ReactNode
}

function QueueList<T extends QueueValue>({ values = [], onReorder, className, children, ...props }: QueueListProps<T>) {
  const { dragAndDropHooks } = useDragAndDrop({
    isDisabled: !onReorder,
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    onReorder: (e) => {
      if (!onReorder) return
      const moving = new Set([...e.keys].map(String))
      const rest = values.filter((v) => !moving.has(String(v.id)))
      const picked = values.filter((v) => moving.has(String(v.id)))
      const at = rest.findIndex((v) => String(v.id) === String(e.target.key))
      if (at < 0) return
      const index = e.target.dropPosition === 'after' ? at + 1 : at
      onReorder([...rest.slice(0, index), ...picked, ...rest.slice(index)])
    },
  })
  return (
    <GridList
      data-slot="prompt-input-queue-list"
      aria-label={props['aria-label'] ?? 'Queued prompts'}
      dragAndDropHooks={dragAndDropHooks}
      selectionMode="none"
      className={cx('flex flex-col gap-1 p-2 outline-none', className)}
    >
      {children}
    </GridList>
  )
}

interface QueueItemProps extends Omit<GridListItemProps, 'className' | 'style' | 'children' | 'id' | 'value'> {
  value: QueueValue & { content?: string }
  className?: string
  children?: ReactNode
}

function QueueItemRoot({ className, value, textValue, children, ...props }: QueueItemProps) {
  return (
    <GridListItem
      data-slot="prompt-input-queue-item"
      id={value.id}
      value={value}
      textValue={textValue ?? value.content ?? String(value.id)}
      {...props}
      className={cx(
        'group/queue-item flex items-center gap-2 rounded-xl border border-border-button-default bg-background-primary-default p-2 outline-none',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'data-[dragging]:opacity-50 data-[drop-target]:ring-2 data-[drop-target]:ring-accent-500',
        className,
      )}
    >
      {children}
    </GridListItem>
  )
}

function QueueItemHandle({ className, 'aria-label': ariaLabel }: { className?: string; 'aria-label'?: string }) {
  return (
    <AriaButton
      slot="drag"
      data-slot="prompt-input-queue-item-handle"
      aria-label={ariaLabel}
      className={cx(
        'flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground-icon-tertiary outline-none',
        'data-[hovered]:bg-background-secondary-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
        <circle cx="6" cy="4" r="1.2" />
        <circle cx="10" cy="4" r="1.2" />
        <circle cx="6" cy="8" r="1.2" />
        <circle cx="10" cy="8" r="1.2" />
        <circle cx="6" cy="12" r="1.2" />
        <circle cx="10" cy="12" r="1.2" />
      </svg>
    </AriaButton>
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
      className={cx('flex shrink-0 text-foreground-icon-secondary [&_svg]:size-4', className)}
    />
  )
}

function QueueItemContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-content"
      {...props}
      className={cx('min-w-0 flex-1 truncate text-body-2-regular text-text-primary', className)}
    />
  )
}

function QueueItemDescription({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="prompt-input-queue-item-description"
      {...props}
      className={cx('shrink-0 text-caption-1-medium text-text-secondary', className)}
    />
  )
}

function QueueItemActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-queue-item-actions"
      {...props}
      className={cx(
        'flex shrink-0 items-center gap-1',
        'group-data-[actions=hover]/queue:opacity-0 group-data-[actions=hover]/queue:group-hover/queue-item:opacity-100 group-data-[actions=hover]/queue:group-focus-within/queue-item:opacity-100',
        className,
      )}
    />
  )
}

type QueueItemActionProps = Omit<ButtonProps, 'variant' | 'size' | 'iconOnly'>

/** A labelled row action (move up, move down, deliver after). */
function QueueItemAction({ className, ...props }: QueueItemActionProps) {
  return (
    <Button
      data-slot="prompt-input-queue-item-action"
      variant="secondary"
      size="xs"
      {...props}
      className={cx('text-text-secondary', className)}
    />
  )
}

type QueueItemRemoveProps = Omit<ButtonProps, 'variant' | 'size' | 'iconOnly' | 'leadingIcon' | 'children'>

/** The row's one icon-only action: an X, named by the caller's `aria-label`. */
function QueueItemRemove({ className, ...props }: QueueItemRemoveProps) {
  return (
    // eslint-disable-next-line meridian-ui/icon-only-needs-name -- wrapper: the caller's aria-label arrives through {...props}
    <Button
      data-slot="prompt-input-queue-item-remove"
      variant="neutral"
      iconOnly
      leadingIcon={X}
      size="xs"
      {...props}
      className={className}
    />
  )
}

interface QueueItemSteerProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  className?: string
  children?: ReactNode
}

/** The text button that switches a row's delivery mode. */
function QueueItemSteer({ className, children, ...props }: QueueItemSteerProps) {
  return (
    <AriaButton
      data-slot="prompt-input-queue-item-steer"
      {...props}
      className={cx(
        'cursor-pointer rounded-md px-1.5 py-0.5 text-caption-1-medium text-text-secondary outline-none',
        'data-[hovered]:bg-background-secondary-hover data-[hovered]:text-text-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    >
      {children}
    </AriaButton>
  )
}

const QueueItem = Object.assign(QueueItemRoot, {
  Handle: QueueItemHandle,
  Steer: QueueItemSteer,
  Remove: QueueItemRemove,
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
  Control: PromptInputControl,
  Send: PromptInputSend,
  Footer: PromptInputFooter,
  Queue,
})
