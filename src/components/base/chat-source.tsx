import React, { useId, useState, type ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface ChatSourceProps extends ComponentProps<'div'> {
  url?: string
  target?: string
  description?: string
  faviconUrl?: string
  href?: string
  title?: string
  onClick?: () => void
}

function ChatSourceRoot({
  className,
  url: _url,
  target: _target,
  onClick: _onClick,
  description: _description,
  faviconUrl: _faviconUrl,
  href: _href,
  title: _title,
  ...props
}: ChatSourceProps) {
  return <div data-slot="chat-source" {...props} className={cx('', className)} />
}

function ChatSourceTrigger({ className, ...props }: ComponentProps<'a'>) {
  return (
    <a
      data-slot="chat-source-trigger"
      {...props}
      className={cx(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-background-secondary-default',
        className,
      )}
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
      className={cx('size-4 shrink-0 rounded-sm', className)}
    />
  ) : (
    <span
      data-slot="chat-source-icon"
      className={cx('size-4 shrink-0 rounded-sm bg-background-secondary-default', className)}
    />
  )
}

function ChatSourceTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="chat-source-title" {...props} className={cx('min-w-0 truncate', className)} />
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
  const panelId = useId()
  return (
    <ChatSourcesContext.Provider value={{ expanded, toggle: () => setExpanded((v) => !v), panelId }}>
      <div data-slot="chat-sources" data-expanded={expanded || undefined} {...props} className={cx('', className)}>
        {children}
      </div>
    </ChatSourcesContext.Provider>
  )
}

const ChatSourcesContext = React.createContext<{ expanded: boolean; toggle: () => void; panelId: string }>({
  expanded: false,
  toggle: () => {},
  panelId: '',
})

function ChatSourcesTrigger({ className, ...props }: ComponentProps<'button'>) {
  const { expanded, toggle, panelId } = React.useContext(ChatSourcesContext)
  return (
    <button
      data-slot="chat-sources-trigger"
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={toggle}
      {...props}
      className={cx('flex items-center gap-1 text-xs font-medium text-text-secondary', className)}
    />
  )
}

function ChatSourcesContent({ className, ...props }: ComponentProps<'div'>) {
  const { expanded, panelId } = React.useContext(ChatSourcesContext)
  return (
    <div
      data-slot="chat-sources-content"
      id={panelId}
      role="region"
      hidden={!expanded}
      {...props}
      className={cx('mt-1', expanded ? '' : 'hidden', className)}
    />
  )
}

function ChatSourcesList({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chat-sources-list" {...props} className={cx('flex flex-col', className)} />
}

export const ChatSources = Object.assign(ChatSourcesRoot, {
  Trigger: ChatSourcesTrigger,
  Content: ChatSourcesContent,
  List: ChatSourcesList,
})
