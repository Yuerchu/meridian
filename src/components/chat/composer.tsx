import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PromptInput } from '@/components/base'
import { ComposerLoader } from '@/components/application/composer-loader/composer-loader'
import { LOADER_PAUSED, useLoaderSettledIdle } from './composer-loader-idle'

import { isSubmitKey } from '@/hooks/use-coarse-pointer'
import { useFileDrop } from '@/hooks/use-file-drop'
import { cx } from '@/utils/cx'

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
   * PromptInput keeps Send as Send whenever there is text in that mode, which leaves no
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
  onKeyDownCapture?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  /** Keeps a caret-aware typeahead in sync without replacing PromptInput's textarea ref. */
  onCaretChange?: (caret: number) => void
  /** A leading bang changes semantics without replacing the textarea. */
  inputMode?: 'prompt' | 'shell'
  /**
   * Queued messages, in their own card above the shell.
   *
   * A sibling of `PromptInput.Shell` rather than a slot inside it, which is
   * where PromptInput puts it and where it belongs: the rows are about messages that
   * have already been written, not about the one being typed.
   */
  queue?: ReactNode
  /** Files dropped on the window, as the `File` objects an HTML5 drop carries. */
  onDropFiles?: (files: File[]) => void
  /**
   * The field element, once there is one.
   *
   * PromptInput points `TextArea`'s ref at its own context and spreads incoming props
   * after it, so passing a ref would replace theirs and take the built-in
   * autosize down with it. Callers that need the element — to focus it, or to
   * read `selectionStart` for a paste — get it this way instead.
   */
  onFieldReady?: (el: HTMLTextAreaElement | null) => void
}

/**
 * The message composer, on PromptInput.
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

  // Capture, not bubble. PromptInput's built-in key handler runs first and has already
  // called `preventDefault` and `onSubmit` by the time a handler passed in
  // would see the event; stopping it here is the only way left to hold Enter
  // back. React ends the dispatch for this element's bubble handler too —
  // `#playground/webview` has the probe that proves it.
  const guardEnter = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDownCapture?.(e)
      if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey) return
      if (!isSubmitKey(e)) e.stopPropagation()
    },
    [onKeyDownCapture],
  )

  const loaderActive = !!(pending || streaming)
  const loaderIdle = useLoaderSettledIdle(loaderActive)

  return (
    <div ref={shellRef} data-slot="composer" className={cx('relative w-full', className)} data-input-mode={inputMode}>
      {notice}
      {suggestions}
      <PromptInput
        value={value}
        onValueChange={onChange}
        onSubmit={handleSubmit}
        onStop={onStop}
        status={pending ? 'submitted' : streaming ? 'streaming' : 'ready'}
        disabled={disabled}
        // Default `true` would grey out the whole toolbar while a reply
        // streams — including the context gauge, which is when it is most worth
        // reading. The field stays live as it always has; only Send becomes
        // Stop.
        lockInputOnRun={false}
        allowSubmitWhileRunning={steerable}
        maxHeight={200}
      >
        {queue}
        {/* boardui's composer-loader, as the registry's agent-composer wires it:
            around the whole shell, lit while a turn runs, and painting the
            surface itself — the shell goes transparent while it is lit (see
            `PromptInput.Shell`). `radius` is the shell's `rounded-3xl` in px,
            because the shell is two rows, not the loader's default pill. */}
        <ComposerLoader active={loaderActive} radius={24} className={cx(loaderIdle && LOADER_PAUSED)}>
          {/* PromptInput styles this state — dotted accent border and a soft fill — but
            sets it for nobody; it is left for whoever owns the drag. */}
          <PromptInput.Shell data-dragging={dropping ? 'true' : undefined}>
            <PromptInput.Content>
              {attachments && <PromptInput.Attachments>{attachments}</PromptInput.Attachments>}
              {inputMode === 'shell' && (
                <div
                  data-slot="composer-shell-badge"
                  className="flex items-center gap-1.5 px-3 pt-2 text-caption-1-medium text-text-secondary"
                  aria-hidden
                >
                  <span data-slot="composer-shell-prefix" className="font-mono text-button-ghost-foreground">
                    !
                  </span>
                  Shell
                </div>
              )}
              <PromptInput.TextArea
                {...fieldProps}
                aria-label={ariaLabel}
                placeholder={placeholder}
                autoFocus={autoFocus}
                onKeyDownCapture={guardEnter}
                onSelect={(event) => onCaretChange?.(event.currentTarget.selectionStart)}
                onKeyUp={(event) => onCaretChange?.(event.currentTarget.selectionStart)}
                onClick={(event) => onCaretChange?.(event.currentTarget.selectionStart)}
                onCompositionStart={() => {
                  composingRef.current = true
                }}
                onCompositionEnd={() => {
                  composingRef.current = false
                }}
              />
            </PromptInput.Content>
            <PromptInput.Toolbar>
              {/* PromptInput's toolbar is a `space-between` flex row inside a shell that
                clips, and neither half is told what to do when the left one
                runs out of room. So a wide left half pushes Send past the
                shell's edge and it is simply gone — which is what a hosted
                session's knobs did. Scrolling is the fix rather than shrinking:
                a squashed picker is unreadable, and the reason there is
                anything to scroll is that the agent decides how many controls
                there are.

                `scrollbar-none` because the app's own scrollbars are 10px and
                one of those under a 32px toolbar is taller than the thing it is
                scrolling — see the note in `index.css` on why the `scrollbar-*`
                utilities other than this one do nothing here. */}
              {/* `p-1 -m-1` is not spacing: `overflow-x: auto` forces
                `overflow-y` to compute as auto too, so without a little slack a
                focus ring on a control in here is clipped at the top and bottom
                — and the negative margin gives the slack back, leaving the row
                exactly where it was.

                The horizontal half was added later and for a second reason:
                PromptInput leaves this slot no inline padding, so the first control sat
                flush against a scroll container's edge and `touch-hitbox` had
                nowhere to expand sideways. The `+` button came out 44px tall
                and still 40px wide — which the harness at
                `#playground/responsive` is what noticed. */}
              {/* `shrink` as well as `min-w-0`, and it is the half that was
                missing: PromptInput sets `flex-shrink: 0` on this slot, and a flex item
                that may not shrink ignores `min-w-0` entirely — so the scroller
                above was real but never narrower than its contents, and Send
                still went over the clipped edge. Both halves of the toolbar
                carry PromptInput's `shrink-0`; this is the one that gives way, because
                the other one is Send. */}
              <PromptInput.ToolbarStart className="-m-1 min-w-0 shrink overflow-x-auto p-1 scrollbar-none [&>*]:shrink-0">
                {toolbarStart}
              </PromptInput.ToolbarStart>
              <PromptInput.ToolbarEnd className="shrink-0">
                {toolbarEnd}
                {/* Drawn by PromptInput exactly when Send is steering, so the
                  two are never both a Stop and the run is never unstoppable.
                  Which of the two Send is, and so which label it wears, is
                  PromptInput's one rule — restating it here is what once put
                  a Stop icon under a "Send" name beside a second Stop. */}
                <PromptInput.Stop label={t('chat.stop')} />
                <PromptInput.Send
                  sendLabel={t('chat.send')}
                  stopLabel={t('chat.stop')}
                  disabled={hasPayload && !streaming ? false : undefined}
                />
              </PromptInput.ToolbarEnd>
            </PromptInput.Toolbar>
          </PromptInput.Shell>
        </ComposerLoader>
      </PromptInput>
    </div>
  )
}
