import { useState, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface ChatSourceProps extends ComponentProps<'div'> {
  url?: string
  target?: string
  description?: string
  faviconUrl?: string
  href?: string
  title?: string
  onPress?: () => void
}

function ChatSourceRoot({
  className,
  url: _url,
  target: _target,
  onPress: _onPress,
  description: _description,
  faviconUrl: _faviconUrl,
  href: _href,
  title: _title,
  ...props
}: ChatSourceProps) {
  return <div data-slot="chat-source" {...props} className={cn('', className)} />
}

function ChatSourceTrigger({ className, ...props }: ComponentProps<'a'>) {
  return (
    <a
      data-slot="chat-source-trigger"
      {...props}
      className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-default', className)}
    />
  )
}

function ChatSourceIcon({ className, faviconUrl, ...props }: ComponentProps<'img'> & { faviconUrl?: string }) {
  return faviconUrl ? (
    <img
      data-slot="chat-source-icon"
      src={faviconUrl}
      alt=""
      {...props}
      className={cn('size-4 shrink-0 rounded-sm', className)}
    />
  ) : (
    <span data-slot="chat-source-icon" className={cn('size-4 shrink-0 rounded-sm bg-default', className)} />
  )
}

function ChatSourceTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="chat-source-title" {...props} className={cn('min-w-0 truncate', className)} />
}

export const ChatSource = Object.assign(ChatSourceRoot, {
  Trigger: ChatSourceTrigger,
  Icon: ChatSourceIcon,
  Title: ChatSourceTitle,
})

interface ChatSourcesProps extends ComponentProps<'div'> {
  defaultExpanded?: boolean
}

function ChatSourcesRoot({ className, defaultExpanded = false, children, ...props }: ChatSourcesProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <div data-slot="chat-sources" data-expanded={expanded || undefined} {...props} className={cn('', className)}>
      <div data-slot="chat-sources-toggle-area" onClick={() => setExpanded((v) => !v)}>
        {/* Trigger rendered via children */}
      </div>
      {children}
    </div>
  )
}

function ChatSourcesTrigger({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      data-slot="chat-sources-trigger"
      type="button"
      {...props}
      className={cn('flex items-center gap-1 text-xs font-medium text-muted', className)}
    />
  )
}

function ChatSourcesContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chat-sources-content" {...props} className={cn('mt-1', className)} />
}

function ChatSourcesList({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chat-sources-list" {...props} className={cn('flex flex-col', className)} />
}

export const ChatSources = Object.assign(ChatSourcesRoot, {
  Trigger: ChatSourcesTrigger,
  Content: ChatSourcesContent,
  List: ChatSourcesList,
})
