import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StopFill } from '@gravity-ui/icons'

import { PromptInput } from '@heroui-pro/react/prompt-input'

import { isSubmitKey } from '@/hooks/use-coarse-pointer'
import { useFileDrop } from '@/hooks/use-file-drop'
import { cn } from '@/lib/utils'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  /** Swaps Send for Stop, and is what `onStop` answers. */
  streaming?: boolean
  onStop?: () => void
  /**
   * Lets Enter submit while a reply is still streaming — steering a run rather
   * than starting a turn.
   *
   * Pro keeps Send as Send whenever there is text in that mode, which leaves no
   * way to stop the run without first emptying the field, so a separate Stop
   * appears beside it. Off, the composer behaves as it always has: Send becomes
   * Stop and nothing can be submitted until the answer is finished.
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
  /** One line above the shell. Not `PromptInput.Footer`, which is below it. */
  notice?: ReactNode
  /** Absolute paths of files dropped on the window. Desktop only. */
  onDropFiles?: (paths: string[]) => void
  /**
   * The field element, once there is one.
   *
   * Pro points `TextArea`'s ref at its own context and spreads incoming props
   * after it, so passing a ref would replace theirs and take the built-in
   * autosize down with it. Callers that need the element — to focus it, or to
   * read `selectionStart` for a paste — get it this way instead.
   */
  onFieldReady?: (el: HTMLTextAreaElement | null) => void
}

/**
 * The message composer, on Pro's PromptInput.
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
  onDropFiles,
  onFieldReady,
}: ComposerProps) {
  const { t } = useTranslation()
  const shellRef = useRef<HTMLDivElement>(null)
  const dropping = useFileDrop(onDropFiles)

  useEffect(() => {
    onFieldReady?.(shellRef.current?.querySelector('textarea') ?? null)
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

  // Capture, not bubble. Pro's built-in key handler runs first and has already
  // called `preventDefault` and `onSubmit` by the time a handler passed in
  // would see the event; stopping it here is the only way left to hold Enter
  // back. React ends the dispatch for this element's bubble handler too —
  // `#playground/heroui` has the probe that proves it.
  const guardEnter = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    if (!isSubmitKey(e)) e.stopPropagation()
  }, [])

  // Pro's own rule for what the send button does, restated because only the
  // label and the extra Stop are ours and both have to agree with it: while a
  // run is going the button stops it, unless steering is on *and* there is
  // something to steer with. An empty steerable field gets Stop back — which is
  // why the label cannot simply follow `steerable`.
  const sendIsStop = !!streaming && !!onStop && !(steerable && value.trim() !== '')

  return (
    <div ref={shellRef} className={cn('w-full', className)}>
      {notice}
      <PromptInput
        value={value}
        onValueChange={onChange}
        onSubmit={handleSubmit}
        onStop={onStop}
        status={streaming ? 'streaming' : 'ready'}
        isDisabled={disabled}
        // Default `true` would grey out the whole toolbar while a reply
        // streams — including the context gauge, which is when it is most worth
        // reading. The field stays live as it always has; only Send becomes
        // Stop.
        lockInputOnRun={false}
        allowSubmitWhileRunning={steerable}
        maxHeight={200}
      >
        {/* Pro styles this state — dotted accent border and a soft fill — but
            sets it for nobody; it is left for whoever owns the drag. */}
        <PromptInput.Shell data-dragging={dropping ? 'true' : undefined}>
          <PromptInput.Content>
            {attachments && <PromptInput.Attachments>{attachments}</PromptInput.Attachments>}
            <PromptInput.TextArea
              aria-label={ariaLabel}
              placeholder={placeholder}
              autoFocus={autoFocus}
              onKeyDownCapture={guardEnter}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
            />
          </PromptInput.Content>
          <PromptInput.Toolbar>
            <PromptInput.ToolbarStart>{toolbarStart}</PromptInput.ToolbarStart>
            <PromptInput.ToolbarEnd>
              {toolbarEnd}
              {/* Exactly when Send is not already a Stop, so the two are never
                  up at once and the run is never unstoppable. */}
              {streaming && onStop && !sendIsStop && (
                <PromptInput.Action aria-label={t('chat.stop')} tooltip={t('chat.stop')} onPress={onStop}>
                  <StopFill />
                </PromptInput.Action>
              )}
              {/* Pro would label it "Send message" / "Stop" in English, and it
                  decides which one it is from the same three values below. */}
              <PromptInput.Send
                aria-label={sendIsStop ? t('chat.stop') : t('chat.send')}
                isDisabled={hasPayload && !streaming ? false : undefined}
              />
            </PromptInput.ToolbarEnd>
          </PromptInput.Toolbar>
        </PromptInput.Shell>
      </PromptInput>
    </div>
  )
}
