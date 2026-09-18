import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

interface ChatAttachmentProps extends ComponentProps<'div'> {
  name?: string
  src?: string
  mediaType?: string
}

function ChatAttachmentRoot({
  className,
  name: _name,
  src: _src,
  mediaType: _mediaType,
  ...props
}: ChatAttachmentProps) {
  return (
    <div
      data-slot="chat-attachment"
      {...props}
      className={cx(
        'relative flex items-center gap-2 rounded-lg border border-border-button-default bg-background-primary-default p-2',
        className,
      )}
    />
  )
}

function ChatAttachmentPreview({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="chat-attachment-preview"
      {...props}
      className={cx('size-8 shrink-0 overflow-hidden rounded-md', className)}
    />
  )
}

function ChatAttachmentInfo({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chat-attachment-info" {...props} className={cx('min-w-0 flex-1', className)} />
}

interface ChatAttachmentRemoveProps extends ComponentProps<'button'> {
  onClick?: () => void
}

function ChatAttachmentRemove({ className, onClick, ...props }: ChatAttachmentRemoveProps) {
  return (
    <button
      data-slot="chat-attachment-remove"
      type="button"
      onClick={onClick}
      {...props}
      className={cx('shrink-0 rounded-full p-0.5 text-text-secondary hover:text-text-primary', className)}
    />
  )
}

export const ChatAttachment = Object.assign(ChatAttachmentRoot, {
  Preview: ChatAttachmentPreview,
  Info: ChatAttachmentInfo,
  Remove: ChatAttachmentRemove,
})

export function ChatAttachmentGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chat-attachment-group" {...props} className={cx('flex flex-wrap gap-2', className)} />
}
