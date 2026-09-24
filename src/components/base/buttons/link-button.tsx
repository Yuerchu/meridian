import type { ComponentType, CSSProperties, ReactNode, Ref } from 'react'
import {
  Button as AriaButton,
  Link as AriaLink,
  type ButtonProps as AriaButtonProps,
  type LinkProps as AriaLinkProps,
} from 'react-aria-components'
import { cx, sortCx } from '@/utils/cx'

/**
 * Link button — an inline text action styled like a link, sized on the same
 * scale as `Button` but without the container: no fill, no border, just the
 * label (plus optional icons) with an underline on hover.
 *
 * Variant / size matrix (mirrors Button's structure):
 *   Variant = primary (blue/600 text) | secondary (text/secondary)
 *   Size    = medium (Body 1/Medium, 20px icons)
 *           | small  (Body 1/Medium, 18px icons)
 *           | xs     (Caption 1/Semibold, 14px icons)
 *
 * Renders an `<a>` when `href` is passed, otherwise a `<button>` — the same
 * action can live in copy ("Learn more →") or trigger a handler. Icons are
 * rendered by the component itself via `leadingIcon` / `trailingIcon` (pass
 * the Remix Icon reference, e.g. `RiArrowRightLine`, not an element).
 *
 * Meridian (boardui.json patches): both elements are React Aria's — `Link` for
 * the `href` case, `Button` otherwise — because a `TooltipTrigger` hands its
 * handlers down through context and only a `usePress`/`useFocusable` consumer
 * receives them. So the API is `onPress` / `isDisabled`, and hover / press /
 * focus-visible are styled from RAC's `data-*` attributes.
 */

type LinkButtonVariant = 'primary' | 'secondary'
type LinkButtonSize = 'medium' | 'small' | 'xs'

type IconComponent = ComponentType<{
  className?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}>

interface LinkButtonBaseProps {
  variant?: LinkButtonVariant
  size?: LinkButtonSize
  leadingIcon?: IconComponent
  trailingIcon?: IconComponent
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

export interface LinkButtonAnchorProps
  extends LinkButtonBaseProps, Omit<AriaLinkProps, 'children' | 'className' | 'style'> {
  href: string
  ref?: Ref<HTMLAnchorElement>
}

export interface LinkButtonButtonProps
  extends LinkButtonBaseProps, Omit<AriaButtonProps, 'children' | 'className' | 'style'> {
  href?: undefined
  ref?: Ref<HTMLButtonElement>
}

export type LinkButtonProps = LinkButtonAnchorProps | LinkButtonButtonProps

const styles = sortCx({
  base: [
    'inline-flex items-center justify-center gap-1 whitespace-nowrap',
    'font-sans select-none cursor-pointer rounded-sm',
    'underline-offset-3 data-[hovered]:underline',
    'transition-colors duration-150 ease',
    'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-border-focus-ring',
    'disabled:cursor-not-allowed disabled:no-underline aria-disabled:cursor-not-allowed aria-disabled:no-underline',
  ].join(' '),

  size: {
    medium: 'text-body-medium',
    small: 'text-body-medium',
    xs: 'text-caption-1-semibold',
  },

  icon: {
    medium: 'size-5 shrink-0',
    small: 'size-[18px] shrink-0',
    xs: 'size-3.5 shrink-0',
  },

  variant: {
    // Hover keeps the resting color — the underline is the hover cue; only
    // the press darkens.
    primary: [
      'text-accent-600 data-[pressed]:text-accent-800',
      'disabled:text-text-tertiary aria-disabled:text-text-tertiary',
    ].join(' '),
    secondary: [
      'text-text-secondary data-[pressed]:text-text-primary',
      'disabled:text-text-tertiary aria-disabled:text-text-tertiary',
    ].join(' '),
  },
})

export function LinkButton({
  variant = 'primary',
  size = 'medium',
  leadingIcon: Leading,
  trailingIcon: Trailing,
  children,
  className,
  ...props
}: LinkButtonProps) {
  const classes = cx(styles.base, styles.size[size], styles.variant[variant], className)
  const content = (
    <>
      {Leading ? <Leading className={styles.icon[size]} aria-hidden /> : null}
      {children !== undefined && children !== null && <span>{children}</span>}
      {Trailing ? <Trailing className={styles.icon[size]} aria-hidden /> : null}
    </>
  )

  if (props.href !== undefined) {
    const { ref, ...linkProps } = props as LinkButtonAnchorProps
    return (
      <AriaLink ref={ref} className={classes} {...linkProps}>
        {content}
      </AriaLink>
    )
  }

  const { ref, ...buttonProps } = props as LinkButtonButtonProps
  return (
    <AriaButton ref={ref} className={classes} {...buttonProps}>
      {content}
    </AriaButton>
  )
}

/** Style maps, exported for advanced composition and the dev Design Tuner. */
export const linkButtonStyles = styles
