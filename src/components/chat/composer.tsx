import './composer.css'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TextArea as AriaTextArea } from 'react-aria-components'
import { ArrowUp } from '@keyline-icons/react/two-tone'
import { Stop } from '@keyline-icons/react/fill'

import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { ComposerLoader } from './composer-loader'
import { LOADER_PAUSED, useLoaderSettledIdle } from './composer-loader-idle'

import { isSubmitKey } from '@/hooks/use-coarse-pointer'
import { useFileDrop } from '@/hooks/use-file-drop'
import { filesFromPaste } from '@/lib/paste-files'

export type ComposerFieldProps = Pick<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'role' | 'aria-expanded' | 'aria-controls' | 'aria-activedescendant' | 'aria-autocomplete'
>

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  /** A submitted message awaiting handoff; keeps Send labelled while showing progress. */
  pending?: boolean
  /** Swaps Send for Stop, and is what `onStop` answers. */
  streaming?: boolean
  onStop?: () => void
  /**
   * Lets Enter submit while a reply is still streaming — steering a run rather
   * than starting a turn.
   *
   * Send stays Send whenever there is text or a payload in that mode, and a
   * separate Stop appears beside it so the run stays stoppable. Off, Send
   * becomes Stop and nothing submits until the answer is finished.
   */
  steerable?: boolean
  placeholder?: string
  ariaLabel: string
  autoFocus?: boolean
  className?: string
  /** Attachment previews, above the field. */
  attachments?: ReactNode
  /** Enables Send for a structured part even when the textarea is empty. */
  hasPayload?: boolean
  /** Left of the toolbar: the tool menu. */
  toolbarStart?: ReactNode
  /** Right of the toolbar, before Send: emoji, voice, context usage. */
  toolbarEnd?: ReactNode
  /** One line above the shell. */
  notice?: ReactNode
  /** Caret-anchored completion menu. The textarea keeps focus while it is open. */
  suggestions?: ReactNode
  /**
   * The textarea's half of the combobox that `suggestions` is the popup of:
   * `role`, `aria-expanded`, `aria-controls`, `aria-activedescendant`,
   * `aria-autocomplete`. Passed through untouched — the caller owns the popup,
   * so it is the one that knows which row is highlighted.
   */
  fieldProps?: ComposerFieldProps
  /** Runs before the composer's submit guard; may consume Enter/Tab/Escape. */
  onKeyDownCapture?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  /** Keeps a caret-aware typeahead in sync without replacing the textarea ref. */
  onCaretChange?: (caret: number) => void
  /** A leading bang changes semantics without replacing the textarea. */
  inputMode?: 'prompt' | 'shell'
  /** Queued messages, in their own card above the shell. */
  queue?: ReactNode
  /**
   * The status tab hanging from the card's top edge (`ComposerStatusTab`).
   * Between the queue and the card, and outside the loader: its light runs
   * inside the shell, and a tab under it would be lit as if it were the field.
   */
  status?: ReactNode
  /** Files dropped on the window, as the `File` objects an HTML5 drop carries. */
  onDropFiles?: (files: File[]) => void
  /** Files pasted into the field. Absent, a paste is only ever text. */
  onPasteFiles?: (files: File[]) => void
  /**
   * The field element, once there is one. Callers that need the element —
   * to focus it, or to read `selectionStart` for a paste — get it this way.
   */
  onFieldReady?: (el: HTMLTextAreaElement | null) => void
}

type ComposerStatus = 'ready' | 'submitted' | 'streaming'
type SendMode = 'send' | 'stop' | 'wait'

const MAX_LINES = 8
const LABEL_SWAP_MS = 220
/**
 * How long a Stop that has just replaced Send ignores presses (Windows' default
 * double-click interval) so a double-click that started a turn cannot stop it.
 */
const STOP_AFTER_SEND_MS = 500

const isRunning = (status: ComposerStatus) => status === 'submitted' || status === 'streaming'

function sendModeOf({
  status,
  allowSubmitWhileRunning,
  value,
  hasPayload,
  onStop,
}: {
  status: ComposerStatus
  allowSubmitWhileRunning: boolean
  value: string
  hasPayload: boolean
  onStop?: () => void
}): SendMode {
  if (!isRunning(status)) return 'send'
  if (allowSubmitWhileRunning && (value.trim() !== '' || hasPayload)) return 'send'
  return onStop ? 'stop' : 'wait'
}

/** `lines` lines of the field's own type plus vertical padding (20px jsdom fallback). */
function linesToPixels(style: CSSStyleDeclaration, lines: number): number {
  const lineHeight = Number.parseFloat(style.lineHeight)
  const padding = [style.paddingTop, style.paddingBottom]
    .map((side) => Number.parseFloat(side))
    .filter(Number.isFinite)
    .reduce((sum, side) => sum + side, 0)
  return lines * (Number.isNaN(lineHeight) ? 20 : lineHeight) + padding
}

/** The lowest of the ceilings that apply: lines and the field's CSS `max-height`. */
function ceilingOf(el: HTMLElement, maxLines: number): number | undefined {
  const style = getComputedStyle(el)
  const css = Number.parseFloat(style.maxHeight)
  const ceilings = [linesToPixels(style, maxLines), Number.isNaN(css) ? undefined : css].filter(
    (value): value is number => value !== undefined,
  )
  return ceilings.length > 0 ? Math.min(...ceilings) : undefined
}

function usePlaceholderSwap(placeholder: string | undefined) {
  const [shown, setShown] = useState(placeholder)
  const [leaving, setLeaving] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  if (placeholder !== shown) {
    setLeaving(shown ?? null)
    setShown(placeholder)
    setChanged(true)
  }
  useEffect(() => {
    if (leaving === null) return
    const timer = window.setTimeout(() => setLeaving(null), LABEL_SWAP_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])
  return { shown, leaving, changed }
}

/**
 * Both of the send button's glyphs, stacked so the button never moves and only
 * its icon transitions across Send / Stop changes.
 */
function SendStopGlyph({ mode }: { mode: SendMode }) {
  const sending = mode === 'send'
  return (
    <span aria-hidden data-slot="prompt-input-send-glyph" className="m-composer__send-glyph">
      <ArrowUp data-active={sending || undefined} className="m-composer__glyph-icon" />
      <Stop data-active={!sending || undefined} className="m-composer__glyph-icon" />
    </span>
  )
}

/**
 * The message composer.
 *
 * Everything hangs off it as a slot, because the two callers want very
 * different amounts of it: the empty state is a field and a send button, the
 * chat view adds attachments, voice, a tool menu, an emoji picker and a context
 * gauge. What they share — autosize, the submit key, the send/stop state — is
 * what lives here.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  pending,
  streaming,
  onStop,
  steerable,
  placeholder,
  ariaLabel,
  autoFocus,
  className,
  attachments,
  hasPayload,
  toolbarStart,
  toolbarEnd,
  notice,
  suggestions,
  fieldProps,
  onKeyDownCapture,
  onCaretChange,
  inputMode = 'prompt',
  queue,
  status,
  onDropFiles,
  onPasteFiles,
  onFieldReady,
}: ComposerProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropping = useFileDrop(onDropFiles)

  useEffect(() => {
    onFieldReady?.(textareaRef.current)
    return () => onFieldReady?.(null)
  }, [onFieldReady])

  // A pinyin or kana candidate lives in the field before it has been chosen.
  // Enter is guarded below, but on a phone the send button is what gets
  // pressed, and it sits next to the candidate bar.
  const composingRef = useRef(false)
  const handleSubmit = useCallback(() => {
    if (composingRef.current) return
    onSubmit()
  }, [onSubmit])

  // Capture, not bubble: the typeahead runs here and may consume Enter/Tab/Escape,
  // and coarse-pointer Enter inserts a newline instead of submitting.
  const guardEnter = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDownCapture?.(e)
      if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey) return
      if (!isSubmitKey(e)) e.stopPropagation()
    },
    [onKeyDownCapture],
  )

  const turnStatus: ComposerStatus = pending ? 'submitted' : streaming ? 'streaming' : 'ready'
  const running = isRunning(turnStatus)
  const loaderActive = Boolean(pending || streaming)
  const loaderIdle = useLoaderSettledIdle(loaderActive)
  const mode = sendModeOf({
    status: turnStatus,
    allowSubmitWhileRunning: Boolean(steerable),
    value,
    hasPayload: Boolean(hasPayload),
    onStop,
  })
  const isPending = mode !== 'send' && turnStatus === 'submitted'

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      const ceiling = ceilingOf(el, MAX_LINES)
      const next = ceiling ? Math.min(el.scrollHeight, ceiling) : el.scrollHeight
      el.style.height = `${next}px`
      el.style.overflowY = ceiling && el.scrollHeight > ceiling ? 'auto' : 'hidden'
    }
    fit()
    window.addEventListener('resize', fit)
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    })
    observer.observe(el)
    return () => {
      window.removeEventListener('resize', fit)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.defaultPrevented) return
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && isSubmitKey(e)) {
        e.preventDefault()
        if (running && !steerable) return
        handleSubmit()
      }
    },
    [handleSubmit, running, steerable],
  )

  const sentAt = useRef(Number.NEGATIVE_INFINITY)
  const handleSendOrStopPress = useCallback(() => {
    if (isPending) return
    if (mode === 'send') {
      sentAt.current = performance.now()
      handleSubmit()
    } else if (mode === 'stop') {
      if (performance.now() - sentAt.current >= STOP_AFTER_SEND_MS) onStop?.()
    }
  }, [handleSubmit, isPending, mode, onStop])

  const swap = usePlaceholderSwap(placeholder)
  const sendLabel = t('chat.send')
  const stopLabel = t('chat.stop')
  const sendDisabled = mode === 'wait' || (Boolean(disabled) && !(hasPayload && !streaming))

  return (
    <div
      data-slot="composer"
      className={className ? `m-composer ${className}` : 'm-composer'}
      data-input-mode={inputMode}
    >
      {notice}
      {suggestions}
      <div data-slot="prompt-input" data-status={turnStatus} className="m-composer__root">
        {queue}
        {status}
        <ComposerLoader
          active={loaderActive}
          paused={loaderIdle}
          radius={24}
          className={loaderIdle ? LOADER_PAUSED : undefined}
        >
          <div
            data-slot="prompt-input-shell"
            data-running={running || undefined}
            data-dragging={dropping ? 'true' : undefined}
            className="m-composer__shell"
          >
            <div data-slot="prompt-input-content" className="m-composer__content">
              {attachments && (
                <div data-slot="prompt-input-attachments" className="m-composer__attachments">
                  {attachments}
                </div>
              )}
              {inputMode === 'shell' && (
                <div data-slot="composer-shell-badge" className="m-composer__shell-badge" aria-hidden>
                  <span data-slot="composer-shell-prefix" className="m-composer__shell-prefix">
                    !
                  </span>
                  Shell
                </div>
              )}
              <div data-slot="prompt-input-field" className="m-composer__field">
                <AriaTextArea
                  ref={textareaRef}
                  data-slot="prompt-input-textarea"
                  {...fieldProps}
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  onKeyDownCapture={guardEnter}
                  onKeyDown={handleKeyDown}
                  onPaste={(event) => {
                    const files = onPasteFiles && filesFromPaste(event.clipboardData)
                    if (!files) return
                    event.preventDefault()
                    onPasteFiles(files)
                  }}
                  onSelect={(event) => onCaretChange?.(event.currentTarget.selectionStart)}
                  onKeyUp={(event) => onCaretChange?.(event.currentTarget.selectionStart)}
                  onClick={(event) => onCaretChange?.(event.currentTarget.selectionStart)}
                  onCompositionStart={() => {
                    composingRef.current = true
                  }}
                  onCompositionEnd={() => {
                    composingRef.current = false
                  }}
                  disabled={disabled}
                  rows={1}
                  autoFocus={autoFocus}
                  aria-label={ariaLabel}
                  aria-placeholder={placeholder}
                  className="m-composer__textarea"
                />
                {value === '' && swap.leaving !== null && (
                  <span key={`out:${swap.leaving}`} aria-hidden className="m-composer__placeholder" data-motion="out">
                    {swap.leaving}
                  </span>
                )}
                {value === '' && swap.shown && (
                  <span
                    key={swap.shown}
                    aria-hidden
                    data-slot="prompt-input-placeholder"
                    className="m-composer__placeholder"
                    data-motion={swap.changed ? 'in' : undefined}
                  >
                    {swap.shown}
                  </span>
                )}
              </div>
            </div>
            <div data-slot="prompt-input-toolbar" className="m-composer__toolbar">
              <div data-slot="prompt-input-toolbar-start" className="m-composer__toolbar-start">
                {toolbarStart}
              </div>
              <div data-slot="prompt-input-toolbar-end" className="m-composer__toolbar-end">
                {toolbarEnd}
                {running && onStop && mode === 'send' && (
                  <span className="m-composer__stop">
                    <TooltipTrigger delay={0}>
                      <Button
                        data-slot="prompt-input-stop"
                        variant="secondary"
                        size="md"
                        icon={<Stop />}
                        aria-label={stopLabel}
                        onPress={onStop}
                      />
                      <Tooltip>{stopLabel}</Tooltip>
                    </TooltipTrigger>
                  </span>
                )}
                <span className="m-composer__send" data-mode={mode}>
                  <Button
                    data-slot="prompt-input-send"
                    data-running={running || undefined}
                    data-pending={isPending || undefined}
                    variant={mode === 'stop' ? 'secondary' : 'primary'}
                    size="md"
                    isDisabled={sendDisabled}
                    onPress={handleSendOrStopPress}
                    aria-label={mode === 'stop' ? stopLabel : sendLabel}
                    icon={
                      isPending ? (
                        <span data-slot="spinner" className="m-composer__send-spinner">
                          <Spinner size="sm" aria-label={sendLabel} />
                        </span>
                      ) : (
                        <SendStopGlyph mode={mode} />
                      )
                    }
                  />
                </span>
              </div>
            </div>
          </div>
        </ComposerLoader>
      </div>
    </div>
  )
}
