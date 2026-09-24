/**
 * The boardui popover motion (motion.md, "Popovers, dropdowns, selects"): 150ms
 * fade + scale-95 + 2px blur in, the same out, with the transform-origin
 * following placement so the panel grows out of its trigger. React Aria stamps
 * `data-entering` for the first frame and `data-exiting` while it holds the
 * element for its exit, so a plain CSS transition plays both ways. The classes
 * are the ones `dropdown/menu-styles.ts` ships in `MENU_POPOVER_SURFACE`; a
 * surface built on that constant already has them and must not add these.
 */
export const OVERLAY_MOTION = [
  'transition duration-150 ease-out',
  'data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]',
  'data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]',
  'data-[placement=bottom]:origin-top-left data-[placement=top]:origin-bottom-left',
  'data-[placement=left]:origin-right data-[placement=right]:origin-left',
].join(' ')

/**
 * The boardui modal motion (motion.md, "Modals"; settings-modal.tsx): 300ms on
 * the modal curve, condensing from `scale-[0.85]` with a 4px blur. The blur
 * stays at 4px and the panel is GPU-promoted because a larger blur re-filtering
 * a whole panel every frame of the scale-down stutters.
 */
export const MODAL_MOTION = [
  'transform-gpu transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-[opacity,transform,filter]',
  'data-[entering]:scale-[0.85] data-[entering]:opacity-0 data-[entering]:blur-[4px]',
  'data-[exiting]:scale-[0.85] data-[exiting]:opacity-0 data-[exiting]:blur-[4px]',
].join(' ')

/** A modal's scrim cross-fades over the same 300ms as its panel, ease-out. */
export const MODAL_BACKDROP_MOTION =
  'transition-opacity duration-300 ease-out data-[entering]:opacity-0 data-[exiting]:opacity-0'

/** The modal scrim, as motion.md and settings-modal.tsx write it. */
// eslint-disable-next-line no-restricted-syntax -- motion.md modal recipe: backdrop bg-black/70
export const MODAL_BACKDROP = 'bg-black/70'

/**
 * A bottom sheet's drag layer: it follows the finger while `data-dragging`,
 * and springs home on release along the same curve it slid in on. The
 * transition is switched off *during* the drag, or every pointer sample would
 * be animated towards and the panel would lag the thumb.
 */
export const SHEET_SPRING = [
  'transition-transform duration-[320ms] ease-[var(--ease-sheet)] will-change-transform',
  'data-[dragging]:transition-none motion-reduce:transition-none',
].join(' ')

export const BACKDROP_MOTION =
  'transition-opacity duration-150 ease-out data-[entering]:opacity-0 data-[exiting]:opacity-0'

/** boardui's menu / popover panel: white, hairline, radius 16, dropdown shadow. */
export const OVERLAY_SURFACE =
  'rounded-2xl border border-border-button-default bg-background-primary-default shadow-dropdown outline-none'

/**
 * The modal panel as settings-modal.tsx draws it: the page fill, a resting
 * shadow, no hairline, radius 24. On `background-full` a field's tertiary well
 * stays visible in both themes.
 */
export const MODAL_SURFACE = 'rounded-3xl bg-background-full shadow-xs outline-none'

export type BackdropVariant = 'opaque' | 'transparent'

/**
 * Every scrim is the modal recipe's `bg-black/70` (motion.md). motion.md has
 * no blurred scrim, so there is none here.
 */
export const BACKDROP_VARIANT: Record<BackdropVariant, string> = {
  opaque: MODAL_BACKDROP,
  transparent: 'bg-transparent',
}
