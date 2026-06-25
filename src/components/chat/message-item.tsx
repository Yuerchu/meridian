import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Bot, Copy, Check, Trash2, RefreshCw, ChevronDown, ChevronRight, Lightbulb, Pencil, X, ThumbsUp, ThumbsDown } from 'lucide-react'
import CountUp from '@/components/CountUp'
import DecryptedText from '@/components/DecryptedText'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ToolCallBlock } from './tool-call-block'
import { renderEmojisInText } from './emoji-renderer'
import type { ContentBlock, Message } from '@/types'
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
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      title={t('chat.copy')}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function CodeBlock({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  const match = /language-(\w+)/.exec(className || '')
  const lang = match ? match[1] : null
  const code = String(children).replace(/\n$/, '')

  if (!className) {
    return <code className="px-1.5 py-0.5 bg-muted rounded text-[13px]" {...props}>{children}</code>
  }

  return (
    <div className="group relative my-3 rounded-lg overflow-hidden bg-card border border-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 text-xs text-muted-foreground">
        <span>{lang ?? 'code'}</span>
        <CopyButton text={code} />
      </div>
      <ScrollArea className="w-full">
        <pre className="p-3 text-[13px] leading-relaxed !bg-transparent !m-0 w-fit min-w-full">
          <code className={className} {...props}>{children}</code>
        </pre>
      </ScrollArea>
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
  return content.replace(
    /\[@([^\]]*)\((\d+)\)\]/g,
    '<span class="inline-flex items-center px-1 py-0.5 rounded bg-blue-500/20 text-blue-300 text-xs font-medium">@$1</span>',
  )
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
    <div className="mb-2 pl-3 border-l-2 border-muted-foreground/30 text-xs text-muted-foreground">
      <span className="font-medium">{sender}</span>
      <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap">{content}</p>
    </div>
  )
}

const MarkdownContent = React.memo(function MarkdownContent({ content, isStreaming, emojiMap }: { content: string; isStreaming?: boolean; emojiMap?: EmojiMap }) {
  const processed = useMemo(() => {
    let result = preprocessEmojis(content, emojiMap)
    result = preprocessMentions(result)
    return result
  }, [content, emojiMap])

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
  const [expanded, setExpanded] = useState(!!isStreaming || !!defaultExpanded)

  return (
    <div className="my-2 rounded-lg border border-border/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/30 transition-colors"
      >
        <Lightbulb className="w-3.5 h-3.5 text-blue-400/70" />
        <span>{t('chat.thinking')}</span>
        {isStreaming && <span className="inline-block w-1.5 h-3 ml-1 bg-muted-foreground/50 animate-pulse" />}
        {expanded
          ? <ChevronDown className="w-3 h-3 ml-auto" />
          : <ChevronRight className="w-3 h-3 ml-auto" />}
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}

function TextBubbles({ content, isStreaming, emojiMap }: { content: string; isStreaming?: boolean; emojiMap?: EmojiMap }) {
  const segments = content.split(/\n---\n/).map((s) => s.trim()).filter(Boolean)
  if (segments.length <= 1) {
    return <MarkdownContent content={content} isStreaming={isStreaming} emojiMap={emojiMap} />
  }
  return (
    <div className="space-y-2">
      {segments.map((seg, i) => (
        <div key={i} className="rounded-xl bg-accent/30 px-3.5 py-2">
          <MarkdownContent
            content={seg}
            isStreaming={isStreaming && i === segments.length - 1}
            emojiMap={emojiMap}
          />
        </div>
      ))}
    </div>
  )
}

function AssistantBlock({ block, isLast, isStreaming, isLastMessage, emojiMap }: { block: ContentBlock; isLast: boolean; isStreaming?: boolean; isLastMessage?: boolean; emojiMap?: EmojiMap }) {
  if (block.type === 'thinking') {
    return <ThinkingBlock text={block.text} isStreaming={isLast && isStreaming} defaultExpanded={!!isLastMessage && isLast} />
  }
  if (block.type === 'text') {
    return <TextBubbles content={block.text} isStreaming={isLast && isStreaming} emojiMap={emojiMap} />
  }
  if (block.type === 'tool_call') {
    return <MemoToolCallBlock data={block.data} />
  }
  return null
}

interface MessageItemProps {
  message: Message
  isStreaming?: boolean
  isLastMessage?: boolean
  onDelete?: (id: string) => void
  onRegenerate?: (id: string) => void
  onEdit?: (id: string, content: string) => void
  onRate?: (id: string, rating: number | null) => void
  emojiMap?: EmojiMap
}

export function MessageItem({ message, isStreaming, isLastMessage, onDelete, onRegenerate, onEdit, onRate, emojiMap }: MessageItemProps) {
  const { t } = useTranslation()
  const relativeTime = useRelativeTime()
  const isUser = message.role === 'user'
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const editRef = useRef<HTMLTextAreaElement>(null)
  const [selectedText, setSelectedText] = useState('')

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
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSaveEdit()
    }
  }, [handleCancelEdit, handleSaveEdit])

  if (isUser) {
    const isMultimodal = message.content.startsWith('[')
    let contentParts: { type: string; text?: string; image_url?: { url: string }; file?: { url: string; name: string; mime_type: string } }[] | null = null
    let textContent = message.content
    if (isMultimodal) {
      try {
        contentParts = JSON.parse(message.content)
        textContent = contentParts?.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n') ?? ''
      } catch { /* not JSON, treat as plain text */ }
    }
    const { senderPrefix, quotedMessage, body } = parseOneBotContent(textContent)

    return (
      <ContextMenu onOpenChange={handleContextMenuOpenChange}>
        <ContextMenuTrigger className="flex justify-end group">
          <div className="max-w-[80%]">
            {senderPrefix && (
              <div className="text-xs text-muted-foreground/60 mb-1 text-right">{senderPrefix}</div>
            )}
            {editing ? (
              <div className="rounded-2xl bg-accent px-4 py-2.5">
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
                  <button
                    onClick={handleCancelEdit}
                    className="px-2 py-0.5 rounded text-xs text-muted-foreground hover:bg-background/50 transition-colors"
                    title="Esc"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="px-2 py-0.5 rounded text-xs text-primary hover:bg-background/50 transition-colors"
                    title="Enter"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-2xl bg-accent px-4 py-2.5 text-sm leading-relaxed">
                  {contentParts && contentParts.some((p) => p.type === 'image_url') && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {contentParts.filter((p) => p.type === 'image_url').map((p, i) => (
                        <img key={i} src={p.image_url?.url} alt="" className="max-w-[200px] max-h-[200px] rounded-lg object-cover" />
                      ))}
                    </div>
                  )}
                  {contentParts && contentParts.some((p) => p.type === 'file') && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {contentParts.filter((p) => p.type === 'file').map((p, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-background/50 rounded">
                          {p.file?.name ?? 'file'}
                        </span>
                      ))}
                    </div>
                  )}
                  {quotedMessage && (
                    <QuotedMessageBlock sender={quotedMessage.sender} content={quotedMessage.content} />
                  )}
                  <div className="whitespace-pre-wrap">
                    {emojiMap && Object.keys(emojiMap).length > 0
                      ? renderEmojisInText(body, emojiMap)
                      : body}
                  </div>
                </div>
                <div className="flex justify-end gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onEdit && (
                    <button
                      onClick={handleStartEdit}
                      className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      title={t('chat.edit')}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <CopyButton text={message.content} />
                  {onDelete && (
                    <button
                      onClick={() => onDelete(message.id)}
                      className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors"
                      title={t('chat.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
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
            <ContextMenuItem variant="destructive" onClick={() => onDelete(message.id)}>
              <Trash2 />
              {t('chat.delete')}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <ContextMenu onOpenChange={handleContextMenuOpenChange}>
      <ContextMenuTrigger className="group">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          {message.model_id && (
            isLastMessage
              ? <DecryptedText text={message.model_id} animateOn="view" speed={25} sequential className="text-xs text-muted-foreground" />
              : <span className="text-xs text-muted-foreground">{message.model_id}</span>
          )}
          <span className="text-xs text-muted-foreground/60">{relativeTime(message.created_at)}</span>
        </div>

        <div className="pl-8">
          {(message._blocks && message._blocks.length > 0) ? (
            message._blocks.map((block, i) => (
              <AssistantBlock key={i} block={block} isLast={i === message._blocks!.length - 1} isStreaming={isStreaming} isLastMessage={isLastMessage} emojiMap={emojiMap} />
            ))
          ) : (
            <MarkdownContent content={message.content} isStreaming={isStreaming} emojiMap={emojiMap} />
          )}

          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {(message.input_tokens || message.output_tokens) && (
              <span className="text-[11px] text-muted-foreground/50 mr-1">
                {message.input_tokens && message.output_tokens
                  ? <><CountUp to={message.input_tokens} separator="," duration={1} /> + <CountUp to={message.output_tokens} separator="," duration={1} /> tokens</>
                  : <><CountUp to={(message.output_tokens ?? message.input_tokens)!} separator="," duration={1} /> tokens</>}
              </span>
            )}
            <div className="flex gap-1">
              <CopyButton text={message.content} />
              {onRate && !isStreaming && (
                <>
                  <button
                    onClick={() => onRate(message.id, message.rating === 1 ? null : 1)}
                    className={cn(
                      'p-1 rounded hover:bg-accent transition-colors',
                      message.rating === 1 ? 'text-green-500' : 'text-muted-foreground hover:text-foreground',
                    )}
                    title={t('chat.thumbsUp')}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onRate(message.id, message.rating === -1 ? null : -1)}
                    className={cn(
                      'p-1 rounded hover:bg-accent transition-colors',
                      message.rating === -1 ? 'text-red-500' : 'text-muted-foreground hover:text-foreground',
                    )}
                    title={t('chat.thumbsDown')}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {onRegenerate && !isStreaming && (
                <button
                  onClick={() => onRegenerate(message.id)}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title={t('chat.regenerate')}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(message.id)}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors"
                  title={t('chat.delete')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
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
          <ContextMenuItem variant="destructive" onClick={() => onDelete(message.id)}>
            <Trash2 />
            {t('chat.delete')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
