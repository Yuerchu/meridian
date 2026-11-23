import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown } from '@keyline-icons/react/two-tone'
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@/lib/message-scroller'
import { usePlatform } from '@/hooks/use-platform'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import './message-scroller.css'

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function MessageScrollerProvider(props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function MessageScroller({ className, ...props }: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={joinClasses('m-message-scroller', className)}
      {...props}
    />
  )
}

function MessageScrollerViewport({
  className,
  'aria-label': ariaLabel,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  const { t } = useTranslation()
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      aria-label={ariaLabel ?? t('chat.messages')}
      className={joinClasses('m-message-scroller__viewport', className)}
      {...props}
    />
  )
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={joinClasses('m-message-scroller__content', className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  const platform = usePlatform()
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      data-android={platform === 'android' || undefined}
      scrollAnchor={scrollAnchor}
      className={joinClasses('m-message-scroller__item', className)}
      {...props}
    />
  )
}

/** An addressable point inside a row — see the primitive for why. Carries no
 *  styles of its own so it can wrap a region without changing its layout. */
function MessageScrollerAnchor({ className, ...props }: React.ComponentProps<typeof MessageScrollerPrimitive.Anchor>) {
  return (
    <MessageScrollerPrimitive.Anchor
      data-slot="message-scroller-anchor"
      className={joinClasses('m-message-scroller__anchor', className)}
      {...props}
    />
  )
}

function MessageScrollerButton({
  direction = 'end',
  className,
  children,
  render,
  variant = 'secondary',
  size = 'sm',
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  const { t } = useTranslation()
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      className={render ? className : undefined}
      render={
        render ??
        ((buttonProps) => {
          const { onClick, className: _ignored, ...rest } = buttonProps
          const active = (buttonProps as Record<string, unknown>)['data-active'] as string | undefined
          return (
            <div
              className={joinClasses('m-message-scroller__button-slot', className)}
              data-active={active}
              data-direction={direction}
            >
              <Button
                icon={<ArrowDown />}
                variant={variant}
                size={size}
                onPress={() => onClick?.({ defaultPrevented: false } as React.MouseEvent<HTMLButtonElement>)}
                {...(rest as React.ComponentProps<typeof Button>)}
              />
            </div>
          )
        })
      }
      aria-label={t(direction === 'end' ? 'chat.scrollToBottom' : 'chat.scrollToTop')}
      {...props}
    >
      {children}
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerAnchor,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
