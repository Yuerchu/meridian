import type { ComponentType, CSSProperties, ReactNode, Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { cx, sortCx } from '@/utils/cx'
import { Spinner } from '../spinner'

/**
 * boardui Button (Figma: Board UI → Buttons, node 3656:13819) on a React Aria
 * `Button`.
 *
 * The registry renders a plain `<button>`. Here the element underneath is RAC's,
 * and that is the whole reason this file differs from the registry copy: every
 * trigger primitive in this app — `TooltipTrigger`, `MenuTrigger`,
 * `DialogTrigger`, a `Dialog`'s `slot="close"` — hands its handlers and its ref
 * down *through context*, and only a `usePress`/`useFocusable` consumer picks
 * them up. A native button silently receives nothing: the tooltip never opens,
 * the menu never appears, the close button closes nothing. So the interaction
 * contract is RAC's (`onPress`, `isDisabled`, `isPending`, `slot`) and the
 * visuals are boardui's, 1:1 with the registry table below.
 *
 *                       Medium                    Small                     Xs
 *   container          h=36, p=8,   r=10         h=32, px=8 py=6, r=8      h=24, px=8, r=4
 *   icon                20×20                     18×18                    14×14
 *   label wrapper       px=4                      px=2                     px=2
 *   text style          Body 1/Medium             Body 1/Medium            Caption 1/Semibold
 *   icon-only square    36×36 (content-derived)   32×32 (forced size)      24×24 (forced size)
 *
 * State is styled from RAC's data attributes rather than CSS pseudo-classes:
 * `data-hovered` does not stick after a touch the way `:hover` does, and
 * `data-pressed` fires for keyboard and virtual presses too.
 *
 * `isPending` keeps the button focusable, suppresses presses, sets
 * `aria-disabled`, and swaps the leading slot for a spinner so the label stays
 * where it was.
 *
 * Icons: pass a component reference (`leadingIcon={RiAddLine}`), never an
 * element, so the size is the component's to decide.
 */

export type ButtonVariant =
  'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost' | 'danger' | 'danger-soft' | 'transparent'
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

const styles = sortCx({
  base: [
    'relative inline-flex items-center justify-center gap-0.5 whitespace-nowrap overflow-hidden',
    'font-sans select-none cursor-[var(--cursor-interactive)]',
    'button-press-motion',
    'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-border-focus-ring',
    'disabled:cursor-not-allowed data-[pending]:cursor-progress',
  ].join(' '),

  size: {
    medium: 'h-9 rounded-2lg p-2 text-body-medium',
    small: 'h-8 rounded-lg px-2 py-1.5 text-body-medium',
    xs: 'h-6 rounded-sm px-2 text-caption-1-semibold',
  },

  // Icon-only: medium is already square from its padding; the two smaller
  // tiers are forced square because Figma's 32/24 do not fall out of the
  // padding arithmetic.
  iconOnlySize: {
    medium: '',
    small: 'size-8 p-0',
    xs: 'size-6 p-0',
  },

  icon: {
    medium: 'size-5 shrink-0',
    small: 'size-[18px] shrink-0',
    xs: 'size-3.5 shrink-0',
  },

  label: {
    medium: 'inline-flex items-center justify-center px-1 shrink-0',
    small: 'inline-flex items-center justify-center px-0.5 shrink-0',
    xs: 'inline-flex items-center justify-center px-0.5 shrink-0',
  },

  variant: {
    primary: [
      'bg-button-primary text-text-white shadow-xs',
      'disabled:text-button-primary-disabled-foreground disabled:shadow-none',
    ].join(' '),
    danger: [
      'bg-button-danger text-text-white shadow-xs',
      'disabled:text-foreground-disabled-danger disabled:shadow-none',
    ].join(' '),
    secondary: [
      'bg-background-primary-default text-text-primary',
      'border border-border-button-default shadow-xs',
      'data-[hovered]:bg-background-primary-hover data-[hovered]:border-border-button-hover',
      'data-[pressed]:bg-background-primary-active data-[pressed]:border-border-button-active',
      'disabled:bg-background-primary-disabled disabled:border-border-button-default disabled:text-text-tertiary disabled:shadow-none',
    ].join(' '),
    tertiary: [
      'bg-background-secondary-default text-text-primary',
      'data-[hovered]:bg-background-secondary-hover',
      'data-[pressed]:bg-background-tertiary-default',
      'disabled:text-text-tertiary',
    ].join(' '),
    outline: [
      'bg-transparent text-text-primary',
      'border border-border-button-default',
      'data-[hovered]:bg-background-primary-hover data-[hovered]:border-border-button-hover',
      'data-[pressed]:bg-background-primary-active',
      'disabled:text-text-tertiary',
    ].join(' '),
    // The registry's ghost is an accent-tinted wash (`button-ghost-*`). In a
    // chat toolbar that reads as every icon being "on", so ghost here is the
    // neutral wash and the accent tint is left to `primary`.
    ghost: [
      'bg-transparent text-text-primary',
      'data-[hovered]:bg-background-secondary-default',
      'data-[pressed]:bg-background-secondary-hover',
      'disabled:text-text-tertiary',
    ].join(' '),
    'danger-soft': [
      'bg-status-danger-soft text-status-danger-soft-foreground',
      'data-[hovered]:bg-status-danger-soft-hover',
      'disabled:text-text-tertiary',
    ].join(' '),
    transparent: [
      'bg-transparent text-text-primary',
      'data-[hovered]:bg-background-secondary-default',
      'disabled:text-text-tertiary',
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
      {...props}
      className={cx(
        styles.base,
        styles.size[size],
        styles.variant[variant],
        iconOnly && styles.iconOnlySize[size],
        className,
      )}
    >
      {isPending ? (
        <Spinner size="sm" color="current" className={styles.icon[size]} />
      ) : Leading ? (
        <Leading className={styles.icon[size]} aria-hidden />
      ) : null}
      {iconOnly && !Leading && !isPending ? children : null}
      {!iconOnly && children !== undefined && children !== null && (
        <span className={styles.label[size]}>{children}</span>
      )}
      {!iconOnly && Trailing ? <Trailing className={styles.icon[size]} aria-hidden /> : null}
    </AriaButton>
  )
}

/** Style maps, exported for composition (e.g. a `Link` drawn as a button). */
export const buttonStyles = styles
