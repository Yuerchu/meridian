import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

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
      className={cn('relative flex items-center gap-2 rounded-lg border border-border bg-surface p-2', className)}
    />
  )
}

function ChatAttachmentPreview({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="chat-attachment-preview"
      {...props}
      className={cn('size-8 shrink-0 overflow-hidden rounded-md', className)}
    />
  )
}

function ChatAttachmentInfo({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chat-attachment-info" {...props} className={cn('min-w-0 flex-1', className)} />
}

interface ChatAttachmentRemoveProps extends ComponentProps<'button'> {
  onPress?: () => void
}

function ChatAttachmentRemove({ className, onPress, ...props }: ChatAttachmentRemoveProps) {
  return (
    <button
      data-slot="chat-attachment-remove"
      type="button"
      onClick={onPress}
      {...props}
      className={cn('shrink-0 rounded-full p-0.5 text-muted hover:text-foreground', className)}
    />
  )
}

export const ChatAttachment = Object.assign(ChatAttachmentRoot, {
  Preview: ChatAttachmentPreview,
  Info: ChatAttachmentInfo,
  Remove: ChatAttachmentRemove,
})

export function ChatAttachmentGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="chat-attachment-group" {...props} className={cn('flex flex-wrap gap-2', className)} />
}
