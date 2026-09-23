import { createContext, useContext, useId, useState, type ComponentProps } from 'react'
import { cx } from '@/utils/cx'
import { HoverCard } from './hover-card'

/**
 * A page an answer cites: favicon, site name, and — when a `description` is
 * given — a hover preview with the page title, which is what a native
 * `title` tooltip used to carry and could not wrap.
 *
 * The trigger is a real anchor, because the caller decides how the URL opens
 * (through the shell plugin, never by navigating the WebView) and needs the
 * click event to do it.
 */

interface SourceContextValue {
  href?: string
  title?: string
  description?: string
  faviconUrl?: string
}

const SourceContext = createContext<SourceContextValue>({})

interface ChatSourceProps extends ComponentProps<'div'> {
  href?: string
  title?: string
  description?: string
  faviconUrl?: string
}

function ChatSourceRoot({ className, href, title, description, faviconUrl, children, ...props }: ChatSourceProps) {
  const value = { href, title, description, faviconUrl }
  const body = (
    <div data-slot="chat-source" {...props} className={cx('min-w-0', className)}>
      {children}
    </div>
  )
  return (
    <SourceContext.Provider value={value}>
      {description ? (
        <HoverCard openDelay={400} closeDelay={150}>
          <HoverCard.Trigger className="min-w-0 max-w-full">{body}</HoverCard.Trigger>
          <HoverCard.Content placement="top" className="w-72">
            <div data-slot="chat-source-preview" className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <ChatSourceIcon />
                <span className="min-w-0 truncate text-caption-1-medium text-text-secondary">{title}</span>
              </div>
              <p data-slot="chat-source-preview-title" className="text-body-medium text-text-primary">
                {description}
              </p>
              {href && (
                <span data-slot="chat-source-preview-url" className="truncate text-caption-1-medium text-text-tertiary">
                  {href}
                </span>
              )}
            </div>
          </HoverCard.Content>
        </HoverCard>
      ) : (
        body
      )}
    </SourceContext.Provider>
  )
}

function ChatSourceTrigger({ className, ...props }: ComponentProps<'a'>) {
  return (
    <a
      data-slot="chat-source-trigger"
      {...props}
      className={cx(
        'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-body-2-medium text-text-primary outline-none',
        'hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        className,
      )}
    />
  )
}

function ChatSourceIcon({
  className,
  faviconUrl: own,
  ...props
}: Omit<ComponentProps<'img'>, 'src'> & { faviconUrl?: string }) {
  const { faviconUrl } = useContext(SourceContext)
  const src = own ?? faviconUrl
  return src ? (
    <img
      data-slot="chat-source-icon"
      src={src}
      alt=""
      {...props}
      className={cx('size-4 shrink-0 rounded-sm', className)}
    />
  ) : (
    <span
      data-slot="chat-source-icon"
      aria-hidden
      className={cx('size-4 shrink-0 rounded-sm bg-background-tertiary-default', className)}
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

/* ------------------------------------------------------------ ChatSources */

const ChatSourcesContext = createContext<{ expanded: boolean; toggle: () => void; panelId: string }>({
  expanded: false,
  toggle: () => {},
  panelId: '',
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

function ChatSourcesTrigger({ className, children, ...props }: ComponentProps<'button'>) {
  const { expanded, toggle, panelId } = useContext(ChatSourcesContext)
  return (
    <button
      data-slot="chat-sources-trigger"
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={toggle}
      {...props}
      className={cx(
        'flex cursor-pointer items-center gap-1 rounded-md text-caption-1-medium text-text-secondary outline-none',
        'hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        className,
      )}
    >
      {children}
    </button>
  )
}

function ChatSourcesContent({ className, ...props }: ComponentProps<'div'>) {
  const { expanded, panelId } = useContext(ChatSourcesContext)
  return (
    <div
      data-slot="chat-sources-content"
      id={panelId}
      role="region"
      hidden={!expanded}
      {...props}
      className={cx('mt-1', className)}
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
