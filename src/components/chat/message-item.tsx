import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Bot, Copy, Check, Trash2, RefreshCw, ChevronDown, ChevronRight, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ToolCallBlock } from './tool-call-block'
import type { ContentBlock, Message } from '@/types'

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

const MarkdownContent = React.memo(function MarkdownContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className={proseClasses}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ code: CodeBlock as never }}>
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-0.5 bg-muted-foreground animate-pulse" />
      )}
    </div>
  )
})

const MemoToolCallBlock = React.memo(ToolCallBlock)

function ThinkingBlock({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(!!isStreaming)

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

function AssistantBlock({ block, isLast, isStreaming }: { block: ContentBlock; isLast: boolean; isStreaming?: boolean }) {
  if (block.type === 'thinking') {
    return <ThinkingBlock text={block.text} isStreaming={isLast && isStreaming} />
  }
  if (block.type === 'text') {
    return <MarkdownContent content={block.text} isStreaming={isLast && isStreaming} />
  }
  if (block.type === 'tool_call') {
    return <MemoToolCallBlock data={block.data} />
  }
  return null
}

interface MessageItemProps {
  message: Message
  isStreaming?: boolean
  onDelete?: (id: string) => void
  onRegenerate?: (id: string) => void
}

export function MessageItem({ message, isStreaming, onDelete, onRegenerate }: MessageItemProps) {
  const { t } = useTranslation()
  const relativeTime = useRelativeTime()
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end group">
        <div className="max-w-[80%] rounded-2xl bg-accent px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="group">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        {message.model_id && (
          <span className="text-xs text-muted-foreground">{message.model_id}</span>
        )}
        <span className="text-xs text-muted-foreground/60">{relativeTime(message.created_at)}</span>
      </div>

      <div className="pl-8">
        {(message._blocks && message._blocks.length > 0) ? (
          message._blocks.map((block, i) => (
            <AssistantBlock key={i} block={block} isLast={i === message._blocks!.length - 1} isStreaming={isStreaming} />
          ))
        ) : (
          <MarkdownContent content={message.content} isStreaming={isStreaming} />
        )}

        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {(message.input_tokens || message.output_tokens) && (
            <span className="text-[11px] text-muted-foreground/50 mr-1">
              {message.input_tokens && message.output_tokens
                ? `${message.input_tokens.toLocaleString()} + ${message.output_tokens.toLocaleString()} tokens`
                : `${(message.output_tokens ?? message.input_tokens)!.toLocaleString()} tokens`}
            </span>
          )}
          <div className="flex gap-1">
            <CopyButton text={message.content} />
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
    </div>
  )
}
