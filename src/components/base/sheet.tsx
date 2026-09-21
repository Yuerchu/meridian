import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  Heading as AriaHeading,
  Modal as AriaModal,
  ModalOverlay,
  type DialogProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { AlertDialog } from './alert-dialog'
import { Button } from './buttons/button'
import { CloseButton } from './buttons/close-button'
import { BACKDROP_MOTION, BACKDROP_VARIANT, type BackdropVariant } from './overlay-motion'

/**
 * A panel sliding in from one edge, on the same React Aria overlay stack as
 * `Modal`. This is also what a "drawer" is here — there is no second
 * component for a bottom sheet.
 *
 *   <Sheet isOpen={open} onOpenChange={setOpen} placement="right">
 *     <Sheet.Backdrop variant="blur">
 *       <Sheet.Content className="sm:max-w-2xl">
 *         <Sheet.Dialog aria-label="…">…</Sheet.Dialog>
 *       </Sheet.Content>
 *     </Sheet.Backdrop>
 *   </Sheet>
 *
 * The root holds the state and the edge; `Backdrop` is the overlay and
 * `Content` is the panel, so a width or height override on `Content` lands on
 * the element that is actually positioned. The slide is a keyframe pair per
 * edge in `styles/meridian.css` (`meridian-sheet-in-*`), because a translate
 * cannot be expressed as a transition from `data-entering` alone without the
 * panel first painting at its resting place.
 *
 * **Every way out that is not the caller's own button arrives at one place.**
 * React Aria hands the scrim, Escape and `slot="close"` to `onOpenChange`
 * alike, so `requestClose` wraps that one callback and `isDirty` is answered
 * once for all three. The back gesture is the exception: it reaches
 * `useHistoryLevel`, which is why the root claims that level rather than each
 * call site. Claimed at both, the call site's would sit *above* the root's —
 * child effects run first — and answer the gesture by closing directly, with
 * the unsaved-work question never asked.
 */

export type SheetPlacement = 'left' | 'right' | 'top' | 'bottom'

interface SheetContextValue {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  isDismissable: boolean
  isKeyboardDismissDisabled: boolean
  placement: SheetPlacement
  /**
   * The one funnel for every dismissal that is not the caller's own button.
   * Returns true when it forwarded the close, false when it asked first.
   */
  requestClose: () => boolean
}

const SheetContext = createContext<SheetContextValue>({
  isDismissable: true,
  isKeyboardDismissDisabled: false,
  placement: 'right',
  requestClose: () => true,
})

interface SheetProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: SheetPlacement
  isDismissable?: boolean
  /** Escape stops dismissing. Parity with `Modal.Backdrop`. */
  isKeyboardDismissDisabled?: boolean
  /**
   * There is unsaved work inside.
   *
   * Every way out that is not the caller's own footer button — the scrim,
   * Escape, the close button, the back gesture, and a downward drag once
   * `Sheet.Handle` has one — asks whether to discard it first. The sheet stays
   * open while the question is up: its `isOpen` must not flicker, or the
   * history hand-over path fires and the entry it is holding is spent.
   *
   * Needs a controlled `isOpen`. Every consumer is.
   */
  isDirty?: boolean
  children?: ReactNode
}

function SheetRoot({
  isOpen,
  placement = 'right',
  onOpenChange,
  isDismissable = true,
  isKeyboardDismissDisabled = false,
  isDirty = false,
  children,
}: SheetProps) {
  const [asking, setAsking] = useState(false)

  const requestClose = useCallback((): boolean => {
    if (!isDirty) {
      onOpenChange?.(false)
      return true
    }
    setAsking(true)
    return false
  }, [isDirty, onOpenChange])

  // `!asking` is what lets a refused close give the entry back.
  //
  // The back gesture reaches here *after* the store has already dropped this
  // level — `settleTo` retires a level and then calls its `dismiss` — so a
  // refusal would otherwise leave the sheet open holding nothing, and the next
  // press would leave the app. Dropping to false and back to true is a fresh
  // edge, which is the only thing `useHistoryLevel` re-registers on; while the
  // question is up its own level stands in, so the depth never changes.
  useHistoryLevel(isOpen === true && !asking, requestClose)

  const value = useMemo(
    () => ({ isOpen, onOpenChange, isDismissable, isKeyboardDismissDisabled, placement, requestClose }),
    [isOpen, onOpenChange, isDismissable, isKeyboardDismissDisabled, placement, requestClose],
  )

  return (
    <SheetContext.Provider value={value}>
      {children}
      <SheetDiscardDialog
        isOpen={asking}
        onKeep={() => setAsking(false)}
        onDiscard={() => {
          setAsking(false)
          onOpenChange?.(false)
        }}
      />
    </SheetContext.Provider>
  )
}

/**
 * "Discard what you typed?", for a sheet that is being closed out from under it.
 *
 * Drawn here rather than through `useConfirm` on purpose. That hook lives above
 * the base layer and renders this same dialog, so reaching for it from inside
 * `Sheet` would have the base layer importing its own consumer. What it would
 * buy is a promise, and there is nothing here to await: two buttons and two
 * outcomes.
 *
 * Centred, never a second sheet: a panel rising over a panel leaves the drag
 * gesture ambiguous about which one it has hold of.
 */
function SheetDiscardDialog({
  isOpen,
  onKeep,
  onDiscard,
}: {
  isOpen: boolean
  onKeep: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  const descId = `${useId()}-discard`
  // Its own level, so one back press answers the question and the next one
  // closes the sheet — rather than the gesture reaching past an open question.
  useHistoryLevel(isOpen, onKeep)
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onKeep()}>
      <AlertDialog.Container>
        <AlertDialog.Dialog aria-describedby={descId}>
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>{t('sheet.discard.title')}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body id={descId}>{t('sheet.discard.body')}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onPress={onDiscard}>
              {t('sheet.discard.confirm')}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

interface SheetBackdropProps {
  variant?: BackdropVariant
  className?: string
  children?: ReactNode
}

function SheetBackdrop({ variant = 'opaque', className, children }: SheetBackdropProps) {
  const { isOpen, onOpenChange, isDismissable, isKeyboardDismissDisabled, requestClose } = useContext(SheetContext)
  return (
    <ModalOverlay
      data-slot="sheet-backdrop"
      isOpen={isOpen}
      // Every close React Aria asks for — the scrim, Escape, a `slot="close"`
      // button — arrives here as `false`, and a dirty sheet answers with a
      // question instead of going. `true` never arrives from a Modal;
      // forwarded anyway rather than silently swallowed.
      onOpenChange={(open) => (open ? onOpenChange?.(true) : void requestClose())}
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      className={cx('fixed inset-0 z-50', BACKDROP_VARIANT[variant], BACKDROP_MOTION, className)}
    >
      {children}
    </ModalOverlay>
  )
}

const position: Record<SheetPlacement, string> = {
  right: 'inset-y-0 right-0 h-full w-[min(100vw,28rem)] rounded-l-2xl',
  left: 'inset-y-0 left-0 h-full w-[min(100vw,28rem)] rounded-r-2xl',
  top: 'inset-x-0 top-0 max-h-[85dvh] rounded-b-2xl',
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl',
}

const EASE = 'cubic-bezier(0.32,0.72,0,1)'
const slide: Record<SheetPlacement, string> = {
  right: `data-[entering]:animate-[meridian-sheet-in-right_320ms_${EASE}] data-[exiting]:animate-[meridian-sheet-out-right_200ms_ease-in]`,
  left: `data-[entering]:animate-[meridian-sheet-in-left_320ms_${EASE}] data-[exiting]:animate-[meridian-sheet-out-left_200ms_ease-in]`,
  top: `data-[entering]:animate-[meridian-sheet-in-top_320ms_${EASE}] data-[exiting]:animate-[meridian-sheet-out-top_200ms_ease-in]`,
  bottom: `data-[entering]:animate-[meridian-sheet-in-bottom_320ms_${EASE}] data-[exiting]:animate-[meridian-sheet-out-bottom_200ms_ease-in]`,
}

interface SheetContentProps {
  /** Overrides the root's edge for this panel. */
  placement?: SheetPlacement
  className?: string
  children?: ReactNode
}

function SheetContent({ placement: own, className, children }: SheetContentProps) {
  const { placement: root } = useContext(SheetContext)
  const placement = own ?? root
  return (
    <AriaModal
      data-slot="sheet-content"
      data-placement={placement}
      className={cx(
        'fixed z-50 flex flex-col bg-background-primary-default shadow-dropdown outline-none motion-reduce:animate-none',
        position[placement],
        slide[placement],
        className,
      )}
    >
      {children}
    </AriaModal>
  )
}

interface SheetDialogProps extends Omit<DialogProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

function SheetDialog({ className, children, ...props }: SheetDialogProps) {
  return (
    <Dialog
      data-slot="sheet-dialog"
      {...props}
      className={cx('relative flex h-full min-h-0 flex-col outline-none', className)}
    >
      {children}
    </Dialog>
  )
}

/** The pill at the top of a bottom sheet. Decoration: it does not drag. */
function SheetHandle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-handle"
      aria-hidden
      {...props}
      className={cx('mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-border-button-default', className)}
    />
  )
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-header" {...props} className={cx('flex shrink-0 flex-col gap-1 px-5 pt-4 pb-2', className)} />
  )
}

function SheetHeading({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <AriaHeading
      data-slot="sheet-heading"
      slot="title"
      {...props}
      className={cx('text-title-3-semibold text-text-primary', className)}
    />
  )
}

function SheetBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-body" {...props} className={cx('min-h-0 flex-auto overflow-y-auto px-5 py-2', className)} />
  )
}

function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      {...props}
      className={cx('flex shrink-0 items-center justify-end gap-2 px-5 pt-2 pb-4', className)}
    />
  )
}

function SheetCloseTrigger({
  className,
  'aria-label': ariaLabel = 'Close',
}: {
  className?: string
  'aria-label'?: string
}) {
  return (
    // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- the X of a dialog is named by aria-label; a tooltip repeating it is noise
    <CloseButton
      slot="close"
      size="sm"
      data-slot="sheet-close-trigger"
      aria-label={ariaLabel}
      className={cx('absolute top-3 right-3', className)}
    />
  )
}

export const Sheet = Object.assign(SheetRoot, {
  Backdrop: SheetBackdrop,
  Content: SheetContent,
  Dialog: SheetDialog,
  Handle: SheetHandle,
  Header: SheetHeader,
  Heading: SheetHeading,
  Body: SheetBody,
  Footer: SheetFooter,
  CloseTrigger: SheetCloseTrigger,
})
