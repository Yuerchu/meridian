import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AlertDialog, type AlertDialogProps } from '@/components/yuerchu-ui/components/dialog/dialog'
import { useHistoryLevel } from '@/hooks/use-history-level'

export interface ConfirmOptions extends Pick<
  AlertDialogProps,
  'description' | 'confirmLabel' | 'cancelLabel' | 'tone'
> {
  /** Defaults to `confirm.title`. */
  heading?: ReactNode
}

/**
 * "Are you sure?", asked for rather than declared.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm()
 * ...
 * if (!await confirm({ description: t('...'), confirmLabel: t('common.delete'), tone: 'danger' })) return
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
 * The dialog is the library's `AlertDialog`: `role="alertdialog"`, Cancel and
 * Escape answer no, the scrim does not dismiss it, and the confirming button
 * names the verb ("Delete", "Discard changes"), never a generic "OK". `tone`
 * is not defaulted here — the library's default is a plain primary button, and
 * a delete has to say `tone: 'danger'` itself.
 *
 * What the library does not know is the back gesture. It answers the question
 * — no — rather than reaching past it to whatever is behind; a hardware key
 * that appears to do nothing reads as the app being stuck, and leaving is the
 * one thing it must not silently do while a destructive question is up. So
 * this claims a history level while the question is open, which is the reason
 * this hook exists beside the library's own `useConfirm`.
 */
export function useConfirm() {
  const { t } = useTranslation()
  const [isOpen, setOpen] = useState(false)
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  // Not state: they are read from inside the close handler, which runs before
  // a state update from the same event would be visible.
  const settleRef = useRef<((ok: boolean) => void) | null>(null)
  const confirmedRef = useRef(false)

  const settle = useCallback((ok: boolean) => {
    const resolve = settleRef.current
    settleRef.current = null
    resolve?.(ok)
  }, [])

  // A question left open when its owner goes is answered no, not left dangling.
  useEffect(() => () => settle(false), [settle])

  const confirm = useCallback(
    (next: ConfirmOptions) => {
      // A question already on screen when a second one arrives is answered no.
      // Nothing does this today; leaving the promise dangling would be a caller
      // that quietly never resumes.
      settle(false)
      confirmedRef.current = false
      setOptions(next)
      setOpen(true)
      return new Promise<boolean>((resolve) => {
        settleRef.current = resolve
      })
    },
    [settle],
  )

  const close = useCallback(() => {
    setOpen(false)
    settle(confirmedRef.current)
  }, [settle])

  useHistoryLevel(isOpen, close)

  return {
    confirm,
    // The options stay put while it closes: clearing them here would empty the
    // dialog for the length of the exit animation.
    confirmDialog: options && (
      <AlertDialog
        {...options}
        heading={options.heading ?? t('confirm.title')}
        isOpen={isOpen}
        onConfirm={() => {
          confirmedRef.current = true
        }}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      />
    ),
  }
}
