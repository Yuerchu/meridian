import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Bot, Copy, Check, Trash2, RefreshCw, FileText, Lightbulb, Pencil, X, ThumbsUp, ThumbsDown } from 'lucide-react'
import CountUp from '@/components/CountUp'
import DecryptedText from '@/components/DecryptedText'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from '@/components/ui/message'
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble'
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import { isSubmitKey } from '@/hooks/use-coarse-pointer'
import { ToolCallBlock } from './tool-call-block'
import { renderEmojisInText } from './emoji-renderer'
import type { ContentBlock, Message as MessageData } from '@/types'
import type { EmojiMap } from './emoji-renderer'

function useRelativeTime() {
  const { t } = useTranslation()
  return (ts: number): string => {
    const diff = Date.now() - ts
    if (diff < 60_000) return t('chat.time.justNow')
    if (diff < 3600_000) return t('chat.time.mAgo', { count: Math.floor(diff / 60_000) })
    if (diff < 86400_000) return t('chat.time.hAgo', { count: Math.floor(diff / 3600_000) })
    return new Date(ts).toLocaleDateString()
  }
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground"
      title={t('chat.copy')}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  )
}

// After rehype-highlight, children is a tree of React elements, so the code
// text has to be collected recursively rather than via String(children).
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) return extractText((node.props as { children?: React.ReactNode }).children)
  return ''
}

function CodeBlock({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  const match = /language-(\w+)/.exec(className || '')
  const lang = match ? match[1] : null
  const rawCode = extractText(children)
  const code = rawCode.replace(/\n$/, '')

  // Fenced blocks without a language get no className; they still contain a
  // trailing newline, while inline code never contains one.
  if (!className && !rawCode.includes('\n')) {
    return <code className="px-1.5 py-0.5 bg-muted rounded text-[13px]" {...props}>{children}</code>
  }

  return (
    <div className="group relative my-3 rounded-lg overflow-hidden bg-card border border-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 text-xs text-muted-foreground">
        <span>{lang ?? 'code'}</span>
        <CopyButton text={code} />
      </div>
      <div className="w-full overflow-x-auto">
        <pre className="p-3 text-[13px] leading-relaxed !bg-transparent !m-0 w-fit min-w-full">
          <code className={className} {...props}>{children}</code>
        </pre>
      </div>
    </div>
  )
}

const proseClasses = cn(
  "text-sm leading-relaxed prose prose-invert prose-sm max-w-none",
  "prose-p:my-1.5 prose-headings:mt-4 prose-headings:mb-2",
  "prose-pre:p-0 prose-pre:bg-transparent prose-pre:my-0",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-table:text-sm prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5",
  "prose-table:border prose-table:border-border",
  "prose-th:border prose-th:border-border prose-th:bg-muted/50",
  "prose-td:border prose-td:border-border",
)

function preprocessEmojis(content: string, emojiMap?: EmojiMap): string {
  if (!emojiMap || Object.keys(emojiMap).length === 0) return content
  return content.replace(/\[emoji:([^\]]+)\]/g, (full, name) => {
    const entry = emojiMap[name]
    if (entry) return `![sticker:${name}](${entry.url})`
    return full
  })
}

function preprocessMentions(content: string): string {
  return content.replace(/\[@([^\]]*)\((\d+)\)\]/g, '**@$1**')
}

interface ParsedOneBotContent {
  senderPrefix: string | null
  quotedMessage: { sender: string; content: string } | null
  body: string
}

function parseOneBotContent(content: string): ParsedOneBotContent {
  let remaining = content

  let quotedMessage: ParsedOneBotContent['quotedMessage'] = null
  const quoteMatch = remaining.match(
    /^<quoted_message sender="([^"]+)">([\s\S]*?)<\/quoted_message>\n?/,
  )
  if (quoteMatch) {
    quotedMessage = { sender: quoteMatch[1], content: quoteMatch[2] }
    remaining = remaining.slice(quoteMatch[0].length)
  }

  let senderPrefix: string | null = null
  const senderMatch = remaining.match(/^\[([^\]]+\(\d+\))\]\s*/)
  if (senderMatch) {
    senderPrefix = senderMatch[1]
    remaining = remaining.slice(senderMatch[0].length)
  }

  return { senderPrefix, quotedMessage, body: remaining }
}

function QuotedMessageBlock({ sender, content }: { sender: string; content: string }) {
  return (
    <div className="mb-2 pl-3 border-l-2 border-primary-foreground/30 text-xs text-primary-foreground/70">
      <span className="font-medium">{sender}</span>
      <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap">{content}</p>
    </div>
  )
}

const MarkdownContent = React.memo(function MarkdownContent({ content, isStreaming, oneBot, emojiMap }: { content: string; isStreaming?: boolean; oneBot?: boolean; emojiMap?: EmojiMap }) {
  const processed = useMemo(() => {
    let result = preprocessEmojis(content, emojiMap)
    if (oneBot) result = preprocessMentions(result)
    return result
  }, [content, emojiMap, oneBot])

  const components = useMemo(() => ({
    code: CodeBlock as never,
    img: ({ alt, src, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
      if (alt?.startsWith('sticker:')) {
        return (
          <img
            src={src}
            alt={alt.slice(8)}
            title={alt.slice(8)}
            className="emoji-sticker block my-2 max-w-[120px] max-h-[120px] w-auto h-auto rounded"
            {...props}
          />
        )
      }
      return <img alt={alt} src={src} {...props} />
    },
  }), [])

  return (
    <div className={proseClasses}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {processed}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-0.5 bg-muted-foreground animate-pulse" />
      )}
    </div>
  )
})

const MemoToolCallBlock = React.memo(ToolCallBlock)

function ThinkingBlock({ text, isStreaming, defaultExpanded }: { text: string; isStreaming?: boolean; defaultExpanded?: boolean }) {
  const { t } = useTranslation()

  return (
    <Accordion
      defaultValue={(isStreaming || defaultExpanded) ? ["thinking"] : []}
      className="my-2 rounded-lg border border-border/50 overflow-hidden"
    >
      <AccordionItem value="thinking" className="border-none">
        <AccordionTrigger className="gap-2 items-center justify-start py-1.5 px-3 text-xs text-muted-foreground font-normal hover:no-underline **:data-[slot=accordion-trigger-icon]:size-3">
          <Lightbulb className="!size-3.5 text-blue-400/70" />
          <span className={isStreaming ? 'shimmer' : undefined}>{t('chat.thinking')}</span>
        </AccordionTrigger>
        <AccordionContent className="px-3 text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
          {text}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function TextBubbles({ content, isStreaming, oneBot, emojiMap }: { content: string; isStreaming?: boolean; oneBot?: boolean; emojiMap?: EmojiMap }) {
  // The \n---\n bubble-splitting protocol only exists for OneBot conversations;
  // in normal chats a markdown horizontal rule must stay a single message.
  const segments = oneBot ? content.split(/\n---\n/).map((s) => s.trim()).filter(Boolean) : [content]
  if (segments.length <= 1) {
    return <MarkdownContent content={content} isStreaming={isStreaming} oneBot={oneBot} emojiMap={emojiMap} />
  }
  return (
    <BubbleGroup>
      {segments.map((seg, i) => (
        <Bubble key={i} variant="muted">
          <BubbleContent>
            <MarkdownContent
              content={seg}
              isStreaming={isStreaming && i === segments.length - 1}
              oneBot={oneBot}
              emojiMap={emojiMap}
            />
          </BubbleContent>
        </Bubble>
      ))}
    </BubbleGroup>
  )
}

function AssistantBlock({ block, isLast, isStreaming, isLastMessage, oneBot, emojiMap }: { block: ContentBlock; isLast: boolean; isStreaming?: boolean; isLastMessage?: boolean; oneBot?: boolean; emojiMap?: EmojiMap }) {
  if (block.type === 'thinking') {
    return <ThinkingBlock text={block.text} isStreaming={isLast && isStreaming} defaultExpanded={!!isLastMessage && isLast} />
  }
  if (block.type === 'text') {
    return <TextBubbles content={block.text} isStreaming={isLast && isStreaming} oneBot={oneBot} emojiMap={emojiMap} />
  }
  if (block.type === 'tool_call') {
    return <MemoToolCallBlock data={block.data} />
  }
  return null
}

interface UserContentPart {
  type: string
  text?: string
  image_url?: { url: string }
  file?: { url: string; name: string; mime_type: string }
}

interface MessageItemProps {
  message: MessageData
  isStreaming?: boolean
  isLastMessage?: boolean
  onDelete?: (id: string) => void
  onRegenerate?: (id: string) => void
  onEdit?: (id: string, content: string) => void
  onRate?: (id: string, rating: number | null) => void
  isOneBot?: boolean
  emojiMap?: EmojiMap
  assistantAvatar?: string | null
  isFirstInGroup?: boolean
  isLastInGroup?: boolean
}

export const MessageItem = React.memo(function MessageItem({ message, isStreaming, isLastMessage, onDelete, onRegenerate, onEdit, onRate, isOneBot, emojiMap, assistantAvatar, isFirstInGroup = true, isLastInGroup = true }: MessageItemProps) {
  const { t } = useTranslation()
  const relativeTime = useRelativeTime()
  const isUser = message.role === 'user'

  // User messages with attachments are stored as a JSON array of parts. Only
  // treat the content as multimodal when every element actually looks like a
  // part; arbitrary text such as "[null]" or "[1,2,3]" must stay plain text.
  const parsedUser = useMemo(() => {
    let contentParts: UserContentPart[] | null = null
    let textContent = message.content
    if (message.role === 'user' && message.content.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(message.content)
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((p) => typeof p === 'object' && p !== null && typeof (p as { type?: unknown }).type === 'string')
        ) {
          contentParts = parsed as UserContentPart[]
          textContent = contentParts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n')
        }
      } catch { /* not JSON, treat as plain text */ }
    }
    return { contentParts, textContent }
  }, [message.role, message.content])
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const editRef = useRef<HTMLTextAreaElement>(null)
  const [selectedText, setSelectedText] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (open) {
      setSelectedText(window.getSelection()?.toString()?.trim() ?? '')
    }
  }, [])

  useEffect(() => {
    if (editing && editRef.current) {
      const ta = editRef.current
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
      ta.style.height = 'auto'
      ta.style.height = ta.scrollHeight + 'px'
    }
  }, [editing])

  const handleStartEdit = useCallback(() => {
    setEditText(message.content)
    setEditing(true)
  }, [message.content])

  const handleSaveEdit = useCallback(() => {
    const trimmed = editText.trim()
    if (trimmed && trimmed !== message.content && onEdit) {
      onEdit(message.id, trimmed)
    }
    setEditing(false)
  }, [editText, message.content, message.id, onEdit])

  const handleCancelEdit = useCallback(() => {
    setEditing(false)
  }, [])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancelEdit()
    } else if (isSubmitKey(e)) {
      e.preventDefault()
      handleSaveEdit()
    }
  }, [handleCancelEdit, handleSaveEdit])

  if (isUser) {
    const { contentParts, textContent } = parsedUser
    const { senderPrefix, quotedMessage, body } = isOneBot
      ? parseOneBotContent(textContent)
      : { senderPrefix: null, quotedMessage: null, body: textContent }

    const hasAttachments = !!contentParts && contentParts.some((p) => p.type === 'image_url' || p.type === 'file')

    const userContent = (
      <ContextMenu onOpenChange={handleContextMenuOpenChange}>
        <ContextMenuTrigger render={<Message align="end" />}>
          <MessageContent>
            {senderPrefix && (
              <MessageHeader className="justify-end text-muted-foreground/60 font-normal">{senderPrefix}</MessageHeader>
            )}
            {hasAttachments && (
              <AttachmentGroup className="items-start max-w-[80%]">
                {contentParts!.filter((p) => p.type === 'image_url').map((p, i) => (
                  <Attachment key={`img-${i}`} orientation="vertical">
                    <AttachmentMedia variant="image">
                      <img src={p.image_url?.url} alt="" />
                    </AttachmentMedia>
                  </Attachment>
                ))}
                {contentParts!.filter((p) => p.type === 'file').map((p, i) => (
                  <Attachment key={`file-${i}`}>
                    <AttachmentMedia>
                      <FileText />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{p.file?.name ?? 'file'}</AttachmentTitle>
                    </AttachmentContent>
                  </Attachment>
                ))}
              </AttachmentGroup>
            )}
            {editing ? (
              <Bubble align="end" variant="outline">
                <BubbleContent>
                  <textarea
                    ref={editRef}
                    value={editText}
                    onChange={(e) => {
                      setEditText(e.target.value)
                      e.target.style.height = 'auto'
                      e.target.style.height = e.target.scrollHeight + 'px'
                    }}
                    onKeyDown={handleEditKeyDown}
                    className="w-full min-w-[200px] bg-transparent text-sm leading-relaxed resize-none outline-none"
                    rows={1}
                  />
                  <div className="flex justify-end gap-1 mt-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleCancelEdit}
                      className="text-muted-foreground"
                      title="Esc"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleSaveEdit}
                      className="text-primary"
                      title="Enter"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </BubbleContent>
              </Bubble>
            ) : (
              <>
                <Bubble align="end" variant="default">
                  <BubbleContent>
                    {quotedMessage && (
                      <QuotedMessageBlock sender={quotedMessage.sender} content={quotedMessage.content} />
                    )}
                    <div className="whitespace-pre-wrap">
                      {emojiMap && Object.keys(emojiMap).length > 0
                        ? renderEmojisInText(body, emojiMap)
                        : body}
                    </div>
                  </BubbleContent>
                </Bubble>
                <MessageFooter className="gap-1 opacity-0 group-hover/message:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleStartEdit}
                      className="text-muted-foreground hover:text-foreground"
                      title={t('chat.edit')}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <CopyButton text={message.content} />
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-muted-foreground hover:text-destructive"
                      title={t('chat.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </MessageFooter>
              </>
            )}
          </MessageContent>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {selectedText && (
            <>
              <ContextMenuItem onClick={() => navigator.clipboard.writeText(selectedText)}>
                <Copy />
                {t('contextMenu.copySelection')}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {onEdit && (
            <ContextMenuItem onClick={handleStartEdit}>
              <Pencil />
              {t('chat.edit')}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => navigator.clipboard.writeText(message.content)}>
            <Copy />
            {t('chat.copy')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {onDelete && (
            <ContextMenuItem variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 />
              {t('chat.delete')}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )

    return (
      <>
        {userContent}
        {onDelete && (
          <AlertDialog open={showDeleteConfirm} onOpenChange={(open) => { if (!open) setShowDeleteConfirm(false) }}>
            <AlertDialogPopup>
              <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('confirm.deleteMessage')}</AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogClose className="bg-accent text-accent-foreground hover:bg-accent/80">
                  {t('common.cancel')}
                </AlertDialogClose>
                <AlertDialogClose
                  className="bg-destructive text-white hover:bg-destructive/80"
                  onClick={() => onDelete(message.id)}
                >
                  {t('common.confirm')}
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        )}
      </>
    )
  }

  const assistantContent = (
    <ContextMenu onOpenChange={handleContextMenuOpenChange}>
      <ContextMenuTrigger render={<Message align="start" />}>
        {isLastInGroup ? (
          <MessageAvatar className="size-8">
            {assistantAvatar ? (
              <img src={assistantAvatar} className="size-full object-cover" />
            ) : (
              <Bot className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </MessageAvatar>
        ) : (
          <div className="min-w-8 shrink-0" />
        )}
        <MessageContent>
          {isFirstInGroup && (
            <MessageHeader className="gap-2">
              {message.model_id && (
                isLastMessage
                  ? <DecryptedText text={message.model_id} animateOn="view" speed={25} sequential className="text-xs text-muted-foreground" />
                  : <span className="text-xs text-muted-foreground">{message.model_id}</span>
              )}
              <span className="text-xs text-muted-foreground/60 font-normal">{relativeTime(message.created_at)}</span>
            </MessageHeader>
          )}

          <Bubble variant="ghost" className="w-full">
            <BubbleContent className="w-full">
              {(message._blocks && message._blocks.length > 0) ? (
                message._blocks.map((block, i) => (
                  <AssistantBlock key={i} block={block} isLast={i === message._blocks!.length - 1} isStreaming={isStreaming} isLastMessage={isLastMessage} oneBot={isOneBot} emojiMap={emojiMap} />
                ))
              ) : (
                <MarkdownContent content={message.content} isStreaming={isStreaming} oneBot={isOneBot} emojiMap={emojiMap} />
              )}
            </BubbleContent>
          </Bubble>

          <MessageFooter className="gap-1 opacity-0 group-hover/message:opacity-100 pointer-coarse:opacity-100 transition-opacity">
            {(message.input_tokens || message.output_tokens) && (
              <span className="text-[11px] text-muted-foreground/50 mr-1 font-normal">
                {message.input_tokens && message.output_tokens
                  ? <><CountUp to={message.input_tokens} separator="," duration={1} /> + <CountUp to={message.output_tokens} separator="," duration={1} /> tokens</>
                  : <><CountUp to={(message.output_tokens ?? message.input_tokens)!} separator="," duration={1} /> tokens</>}
              </span>
            )}
            <div className="flex gap-1">
              <CopyButton text={message.content} />
              {onRate && !isStreaming && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRate(message.id, message.rating === 1 ? null : 1)}
                    className={cn(
                      message.rating === 1 ? 'text-green-500' : 'text-muted-foreground hover:text-foreground',
                    )}
                    title={t('chat.thumbsUp')}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRate(message.id, message.rating === -1 ? null : -1)}
                    className={cn(
                      message.rating === -1 ? 'text-red-500' : 'text-muted-foreground hover:text-foreground',
                    )}
                    title={t('chat.thumbsDown')}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
              {onRegenerate && !isStreaming && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRegenerate(message.id)}
                  className="text-muted-foreground hover:text-foreground"
                  title={t('chat.regenerate')}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-muted-foreground hover:text-destructive"
                  title={t('chat.delete')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </MessageFooter>
        </MessageContent>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {selectedText && (
          <>
            <ContextMenuItem onClick={() => navigator.clipboard.writeText(selectedText)}>
              <Copy />
              {t('contextMenu.copySelection')}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(message.content)}>
          <Copy />
          {t('chat.copy')}
        </ContextMenuItem>
        {onRate && !isStreaming && (
          <>
            <ContextMenuItem onClick={() => onRate(message.id, message.rating === 1 ? null : 1)}>
              <ThumbsUp className={message.rating === 1 ? 'text-green-500' : ''} />
              {t('chat.thumbsUp')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRate(message.id, message.rating === -1 ? null : -1)}>
              <ThumbsDown className={message.rating === -1 ? 'text-red-500' : ''} />
              {t('chat.thumbsDown')}
            </ContextMenuItem>
          </>
        )}
        {onRegenerate && !isStreaming && (
          <ContextMenuItem onClick={() => onRegenerate(message.id)}>
            <RefreshCw />
            {t('chat.regenerate')}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {onDelete && (
          <ContextMenuItem variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 />
            {t('chat.delete')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )

  return (
    <>
      {assistantContent}
      {onDelete && (
        <AlertDialog open={showDeleteConfirm} onOpenChange={(open) => { if (!open) setShowDeleteConfirm(false) }}>
          <AlertDialogPopup>
            <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirm.deleteMessage')}</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogClose className="bg-accent text-accent-foreground hover:bg-accent/80">
                {t('common.cancel')}
              </AlertDialogClose>
              <AlertDialogClose
                className="bg-destructive text-white hover:bg-destructive/80"
                onClick={() => onDelete(message.id)}
              >
                {t('common.confirm')}
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      )}
    </>
  )
})
