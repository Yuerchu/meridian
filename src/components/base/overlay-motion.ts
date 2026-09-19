/**
 * The boardui overlay motion language, as class strings every popover-shaped
 * surface composes: 150ms fade + scale-95 + 2px blur in, the same out. React
 * Aria stamps `data-entering` for the first frame and `data-exiting` while it
 * holds the element for its exit, so a plain CSS transition plays both ways.
 * Press feedback darkens and never scales; exits are as fast as entrances
 * because there is nothing slower to wait for.
 */
export const OVERLAY_MOTION = [
  'transition duration-150 ease-out',
  'data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]',
  'data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]',
].join(' ')

export const BACKDROP_MOTION =
  'transition-opacity duration-150 ease-out data-[entering]:opacity-0 data-[exiting]:opacity-0'

/** boardui's menu / popover panel: white, hairline, radius 16, dropdown shadow. */
export const OVERLAY_SURFACE =
  'rounded-2xl border border-border-button-default bg-background-primary-default shadow-dropdown outline-none'

export type BackdropVariant = 'blur' | 'opaque' | 'transparent'

export const BACKDROP_VARIANT: Record<BackdropVariant, string> = {
  blur: 'bg-backdrop/40 backdrop-blur-sm',
  opaque: 'bg-backdrop/50',
  transparent: 'bg-transparent',
}
