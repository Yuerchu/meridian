import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PromptInput } from '@heroui-pro/react/prompt-input'

import { isSubmitKey } from '@/hooks/use-coarse-pointer'
import { cn } from '@/lib/utils'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  /** Swaps Send for Stop, and is what `onStop` answers. */
  streaming?: boolean
  onStop?: () => void
  placeholder?: string
  ariaLabel: string
  autoFocus?: boolean
  className?: string
  /** Attachment previews, above the field. */
  attachments?: ReactNode
  /** Left of the toolbar: the tool menu. */
  toolbarStart?: ReactNode
  /** Right of the toolbar, before Send: emoji, voice, context usage. */
  toolbarEnd?: ReactNode
  /** Sits over the field itself — Android's hold-to-talk layer. */
  pressLayer?: ReactNode
  /** One line above the shell. Not `PromptInput.Footer`, which is below it. */
  notice?: ReactNode
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
  placeholder,
  ariaLabel,
  autoFocus,
  className,
  attachments,
  toolbarStart,
  toolbarEnd,
  pressLayer,
  notice,
  onFieldReady,
}: ComposerProps) {
  const { t } = useTranslation()
  const shellRef = useRef<HTMLDivElement>(null)

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
        maxHeight={200}
      >
        <PromptInput.Shell>
          <PromptInput.Content>
            {attachments && <PromptInput.Attachments>{attachments}</PromptInput.Attachments>}
            <div className="relative w-full">
              <PromptInput.TextArea
                aria-label={ariaLabel}
                placeholder={placeholder}
                autoFocus={autoFocus}
                onKeyDownCapture={guardEnter}
                onCompositionStart={() => { composingRef.current = true }}
                onCompositionEnd={() => { composingRef.current = false }}
              />
              {pressLayer}
            </div>
          </PromptInput.Content>
          <PromptInput.Toolbar>
            <PromptInput.ToolbarStart>{toolbarStart}</PromptInput.ToolbarStart>
            <PromptInput.ToolbarEnd>
              {toolbarEnd}
              {/* Pro would label it "Send message" / "Stop" in English. */}
              <PromptInput.Send aria-label={streaming ? t('chat.stop') : t('chat.send')} />
            </PromptInput.ToolbarEnd>
          </PromptInput.Toolbar>
        </PromptInput.Shell>
      </PromptInput>
    </div>
  )
}
