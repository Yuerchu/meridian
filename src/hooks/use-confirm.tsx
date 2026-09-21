import { useCallback, useRef, useState } from 'react'

import { ConfirmDialog, type ConfirmOptions } from '@/components/ui/confirm-dialog'

/**
 * The same dialog, asked for rather than declared.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm()
 * ...
 * if (!await confirm({ body: t('...') })) return
 * await api.deleteThing(id)
 * ...
 * {confirmDialog}
 * ```
 *
 * The seven destructive buttons in Settings had no confirmation at all, and
 * this is why: declaring one costs a piece of state for whether it is open and
 * a second for *which row* it was opened over, at every call site, before any
 * of them had a reason to exist. Awaiting the answer instead means the row is
 * still the local variable it always was — there is nothing to remember,
 * because nothing was forgotten.
 *
 * Anything a caller does after the await runs a frame later than it used to.
 * Nothing here is optimistic, so that costs a repaint and nothing else.
 *
 * The back gesture answers the question — no — rather than reaching past it to
 * whatever is behind; a hardware key that appears to do nothing reads as the
 * app being stuck, and leaving is the one thing it must not silently do while a
 * destructive question is up. That history level is claimed by `ConfirmDialog`
 * rather than here, because on a phone the dialog *is* a `Sheet`, which claims
 * one of its own: two levels for one question would take two presses to answer.
 */
export function useConfirm() {
  const [isOpen, setOpen] = useState(false)
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  // Not state: it is read from inside the close handler, which runs before a
  // state update from the same event would be visible.
  const settleRef = useRef<((ok: boolean) => void) | null>(null)

  const settle = useCallback((ok: boolean) => {
    const resolve = settleRef.current
    settleRef.current = null
    resolve?.(ok)
  }, [])

  const confirm = useCallback(
    (next: ConfirmOptions) => {
      // A question already on screen when a second one arrives is answered no.
      // Nothing does this today; leaving the promise dangling would be a caller
      // that quietly never resumes.
      settle(false)
      setOptions(next)
      setOpen(true)
      return new Promise<boolean>((resolve) => {
        settleRef.current = resolve
      })
    },
    [settle],
  )

  return {
    confirm,
    // The options stay put while it closes: clearing them here would empty the
    // dialog for the length of the exit animation.
    confirmDialog: options && (
      <ConfirmDialog
        {...options}
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            settle(false)
            setOpen(false)
          }
        }}
        onConfirm={() => settle(true)}
      />
    ),
  }
}
