import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'
import { File } from '@keyline-icons/react/two-tone'
import { cx } from '@/utils/cx'
import { CloseButton } from './buttons/close-button'

/**
 * A file or image on a message or in the composer: a thumbnail (or a file
 * glyph), the name, and — in the composer — a remove button. The root holds
 * what it was given and the parts read it through context, so a caller can
 * order or omit parts without repeating the data.
 */

interface AttachmentContextValue {
  name?: string
  src?: string
  mediaType?: string
}

const AttachmentContext = createContext<AttachmentContextValue>({})

export interface ChatAttachmentProps extends ComponentProps<'div'> {
  name?: string
  src?: string
  mediaType?: string
}

function ChatAttachmentRoot({ className, name, src, mediaType, children, ...props }: ChatAttachmentProps) {
  return (
    <AttachmentContext.Provider value={{ name, src, mediaType }}>
      <div
        data-slot="chat-attachment"
        data-media-type={mediaType}
        {...props}
        className={cx(
          'relative flex max-w-64 items-center gap-2 rounded-xl border border-border-button-default bg-background-primary-default p-2 shadow-xs',
          className,
        )}
      >
        {children ?? (
          <>
            <ChatAttachmentPreview />
            <ChatAttachmentInfo />
          </>
        )}
      </div>
    </AttachmentContext.Provider>
  )
}

function ChatAttachmentPreview({ className, ...props }: ComponentProps<'div'>) {
  const { name, src, mediaType } = useContext(AttachmentContext)
  const isImage = mediaType === 'image' || (!mediaType && !!src)
  return (
    <div
      data-slot="chat-attachment-preview"
      {...props}
      className={cx(
        'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background-tertiary-default text-foreground-icon-secondary',
        className,
      )}
    >
      {isImage && src ? (
        <img src={src} alt={name ?? ''} className="size-full object-cover" />
      ) : (
        <File className="size-5" aria-hidden />
      )}
    </div>
  )
}

function ChatAttachmentInfo({ className, children, ...props }: ComponentProps<'div'>) {
  const { name } = useContext(AttachmentContext)
  return (
    <div data-slot="chat-attachment-info" {...props} className={cx('min-w-0 flex-1', className)}>
      {children ?? (
        <span data-slot="chat-attachment-name" className="block truncate text-body-2-medium text-text-primary">
          {name}
        </span>
      )}
    </div>
  )
}

interface ChatAttachmentRemoveProps {
  'aria-label': string
  onPress?: () => void
  className?: string
}

function ChatAttachmentRemove({ className, ...props }: ChatAttachmentRemoveProps) {
  return <CloseButton size="2xs" data-slot="chat-attachment-remove" {...props} className={cx('shrink-0', className)} />
}

export const ChatAttachment = Object.assign(ChatAttachmentRoot, {
  Preview: ChatAttachmentPreview,
  Info: ChatAttachmentInfo,
  Remove: ChatAttachmentRemove,
})

export function ChatAttachmentGroup({
  className,
  children,
  ...props
}: ComponentProps<'div'> & { children?: ReactNode }) {
  return (
    <div data-slot="chat-attachment-group" {...props} className={cx('flex flex-wrap gap-2', className)}>
      {children}
    </div>
  )
}
