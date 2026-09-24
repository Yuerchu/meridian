import type { AnchorHTMLAttributes, ComponentType, CSSProperties, ReactNode, Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { cx, sortCx } from '@/utils/cx'
import { Spinner } from '../spinner'

/**
 * Figma source: Board UI → Buttons (node 3656:13819).
 *
 * Variant matrix from Figma:
 *   Type     = Primary | Secondary | Ghost | Danger
 *   Size     = Medium  | Small | Xs
 *   State    = Default | Hover | Active | Disabled        (CSS pseudo)
 *   OnlyIcon = false   | true
 *
 * Sizing (1:1 with Figma):
 *
 *                       Medium                    Small                     Xs
 *   container          h=36, p=8,   r=10         h=32, px=8 py=6, r=8      h=24, px=8, r=4
 *   gap                 2px                       2px                      1.33px→1
 *   icon                20×20                     18×18                    14×14
 *   label wrapper       px=4                      px=2                     px=2
 *   text style          Body 1/Medium             Body 1/Medium            Caption 1/Semibold
 *   icon-only square    36×36 (content-derived)   32×32 (forced size)      24×24 (forced size)
 *
 * `xs` is the smallest tier — first needed for the calendar template's
 * event-details modal ("Join" / edit-icon buttons, node 3920:10954), which
 * scales every dimension down by the same ~0.667 factor from Figma; the
 * table above rounds those to clean pixel values rather than reproducing
 * the fractional source numbers.
 *
 * Icons are rendered by the component itself via the `leadingIcon` /
 * `trailingIcon` props so the consumer can't pass the wrong size. Pass
 * a Remix Icon component reference (`RiAddLine`, not `<RiAddLine />`).
 *
 * For icon-only buttons:
 *   <Button iconOnly leadingIcon={RiAddLine} aria-label="Add" />
 *
 * The HTML `type` prop is preserved; Figma's "Type" enum is renamed to
 * `variant` to avoid the clash.
 *
 * Meridian (boardui.json patches): the element is React Aria's `Button`, not a
 * native `<button>` — every trigger in this app (TooltipTrigger, MenuTrigger,
 * DialogTrigger, `slot="close"`) reaches it through context, which only a
 * `usePress` consumer receives. So the API is `onPress` / `isDisabled` /
 * `isPending` / `slot`, and hover/press/focus-visible are styled from RAC's
 * `data-*` attributes. `isPending` swaps the leading icon for a spinner.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'neutral'
export type ButtonSize = 'medium' | 'small' | 'xs'

type IconComponent = ComponentType<{
  className?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}>

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  variant?: ButtonVariant
  size?: ButtonSize
  iconOnly?: boolean
  leadingIcon?: IconComponent
  trailingIcon?: IconComponent
  children?: ReactNode
  className?: string
  style?: CSSProperties
  ref?: Ref<HTMLButtonElement>
}

export interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  iconOnly?: boolean
  leadingIcon?: IconComponent
  trailingIcon?: IconComponent
  children?: ReactNode
  ref?: Ref<HTMLAnchorElement>
}

const styles = sortCx({
  base: [
    'inline-flex items-center justify-center gap-0.5 whitespace-nowrap overflow-hidden',
    'font-sans select-none cursor-pointer',
    'button-press-motion',
    'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-border-focus-ring',
    'disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
  ].join(' '),

  // Base shape per size (used when label is present OR medium icon-only).
  size: {
    medium: 'h-9 rounded-2lg p-2 text-body-medium',
    small: 'h-8 rounded-lg px-2 py-1.5 text-body-medium',
    xs: 'h-6 rounded-sm px-2 text-caption-1-semibold',
  },

  // Icon-only override:
  //   Medium → keep p-2; w expands from content (8+20+8 = 36) → square.
  //   Small  → Figma forces 32×32 even though 8+18+8=34, so we hard-set size-8
  //            and zero the padding; the inner flex centers the 18px icon.
  //   Xs     → forces 24×24, content-centered — used for the calendar
  //            template's edit-icon buttons (timezone/participants/reminder).
  iconOnlySize: {
    medium: '', // base size already produces 36×36 with a 20px icon
    small: 'size-8 p-0', // hard 32×32, content-centered
    xs: 'size-6 p-0', // hard 24×24, content-centered
  },

  icon: {
    medium: 'size-5 shrink-0', // 20px
    small: 'size-[18px] shrink-0', // 18px
    xs: 'size-3.5 shrink-0', // 14px
  },

  label: {
    medium: 'inline-flex items-center justify-center px-1 shrink-0', // px=4
    small: 'inline-flex items-center justify-center px-0.5 shrink-0', // px=2
    xs: 'inline-flex items-center justify-center px-0.5 shrink-0', // px=2
  },

  variant: {
    primary: [
      'bg-button-primary text-text-white shadow-xs',
      'disabled:text-button-primary-disabled-foreground disabled:shadow-none',
      'aria-disabled:text-button-primary-disabled-foreground aria-disabled:shadow-none',
    ].join(' '),
    danger: [
      'bg-button-danger text-text-white shadow-xs',
      'disabled:text-foreground-disabled-danger disabled:shadow-none',
      'aria-disabled:text-foreground-disabled-danger aria-disabled:shadow-none',
    ].join(' '),
    secondary: [
      'bg-background-primary-default text-text-primary',
      'border border-border-button-default shadow-xs',
      'data-[hovered]:bg-background-primary-hover  data-[hovered]:border-border-button-hover',
      'data-[pressed]:bg-background-primary-active data-[pressed]:border-border-button-active',
      'disabled:bg-background-primary-disabled disabled:border-border-button-default disabled:text-text-tertiary disabled:shadow-none',
      'aria-disabled:bg-background-primary-disabled aria-disabled:border-border-button-default aria-disabled:text-text-tertiary aria-disabled:shadow-none',
    ].join(' '),
    ghost: [
      'bg-button-ghost-background text-button-ghost-foreground',
      'data-[hovered]:bg-button-ghost-hover data-[pressed]:bg-button-ghost-active',
      'disabled:bg-button-ghost-disabled disabled:text-button-ghost-disabled-foreground disabled:shadow-none',
      'aria-disabled:bg-button-ghost-disabled aria-disabled:text-button-ghost-disabled-foreground aria-disabled:shadow-none',
    ].join(' '),
    // Meridian (boardui.json patches): the registry's grey round icon control,
    // copied from the Dropdown usage example in components.md (`size-9 rounded-full
    // bg-background-secondary-default p-2 hover:bg-background-secondary-hover`, icon
    // `text-foreground-icon-secondary`). Pressed is the next step of the ladder.
    neutral: [
      'rounded-full bg-background-secondary-default text-foreground-icon-secondary',
      'data-[hovered]:bg-background-secondary-hover data-[pressed]:bg-background-tertiary-hover',
      'disabled:text-text-disabled aria-disabled:text-text-disabled',
    ].join(' '),
  },
})

export function Button({
  variant = 'primary',
  size = 'medium',
  iconOnly = false,
  leadingIcon: Leading,
  trailingIcon: Trailing,
  isPending = false,
  children,
  className,
  ref,
  ...props
}: ButtonProps) {
  return (
    <AriaButton
      ref={ref}
      isPending={isPending}
      aria-disabled={isPending || undefined}
      className={cx(
        styles.base,
        styles.size[size],
        styles.variant[variant],
        iconOnly && styles.iconOnlySize[size],
        className,
      )}
      {...props}
    >
      {isPending ? (
        <Spinner size="sm" color="current" className={styles.icon[size]} aria-hidden />
      ) : Leading ? (
        <Leading className={styles.icon[size]} aria-hidden />
      ) : null}
      {!iconOnly && children !== undefined && children !== null && (
        <span className={styles.label[size]}>{children}</span>
      )}
      {!iconOnly && Trailing ? <Trailing className={styles.icon[size]} aria-hidden /> : null}
    </AriaButton>
  )
}

/** Anchor counterpart to Button for navigational actions. */
export function ButtonLink({
  variant = 'primary',
  size = 'medium',
  iconOnly = false,
  leadingIcon: Leading,
  trailingIcon: Trailing,
  children,
  className,
  ref,
  ...props
}: ButtonLinkProps) {
  return (
    <a
      ref={ref}
      className={cx(
        styles.base,
        styles.size[size],
        styles.variant[variant],
        iconOnly && styles.iconOnlySize[size],
        className,
      )}
      {...props}
    >
      {Leading ? <Leading className={styles.icon[size]} aria-hidden /> : null}
      {!iconOnly && children !== undefined && children !== null && (
        <span className={styles.label[size]}>{children}</span>
      )}
      {!iconOnly && Trailing ? <Trailing className={styles.icon[size]} aria-hidden /> : null}
    </a>
  )
}

/** Style maps, exported for advanced composition and the dev Design Tuner. */
export const buttonStyles = styles
