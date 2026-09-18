import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

function ChatLoaderDots({ className, label, ...props }: ComponentProps<'span'> & { label?: string }) {
  return (
    <span
      data-slot="chat-loader-dots"
      role="status"
      aria-label={label}
      {...props}
      className={cx('inline-flex items-center gap-1', className)}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          data-slot="chat-loader-dot"
          className="size-1.5 rounded-full bg-background-tertiary-default animate-[pulse_1.5s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 200}ms` }}
        />
      ))}
    </span>
  )
}

export const ChatLoader = Object.assign(() => null, { Dots: ChatLoaderDots })
