import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@/lib/message-scroller'

import { cn } from '@/lib/utils'
import { usePlatform } from '@/hooks/use-platform'
import { Button } from '@heroui/react'
import { ArrowDown } from '@gravity-ui/icons'

function MessageScrollerProvider(props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function MessageScroller({ className, ...props }: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn('group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden', className)}
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
      // scroll-fade-b（滚动驱动 mask 动画）与 contain-content 在 WebView2
      // 滚动时产生内容错位残影，与 content-visibility 崩溃同源，一并移除
      className={cn(
        'size-full min-h-0 min-w-0 scrollbar-gutter-stable overflow-y-auto overscroll-contain data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent',
        className,
      )}
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
      className={cn('flex h-max min-h-full flex-col gap-6', className)}
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
      scrollAnchor={scrollAnchor}
      // content-visibility:auto crashes WebView2 (STATUS_ACCESS_VIOLATION).
      // Android WebView is unaffected — restore the optimization there only.
      className={cn(
        'min-w-0 shrink-0',
        platform === 'android' && '[content-visibility:auto] [contain-intrinsic-size:auto_120px]',
        className,
      )}
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
      className={cn('min-w-0', className)}
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
      className={cn(
        'absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 motion-reduce:transition-none hover:bg-default hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180',
        className,
      )}
      render={
        render ??
        // `dom` hands back intrinsic `<button>` props; HeroUI types its own
        // handlers against React Aria's synthetic events, which are the same
        // objects with a wider element type.
        ((buttonProps) => (
          <Button isIconOnly variant={variant} size={size} {...(buttonProps as React.ComponentProps<typeof Button>)} />
        ))
      }
      {...props}
    >
      {children ?? (
        <>
          <ArrowDown />
          <span className="sr-only">{t(direction === 'end' ? 'chat.scrollToBottom' : 'chat.scrollToTop')}</span>
        </>
      )}
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
