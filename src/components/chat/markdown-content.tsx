import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'

import { ActionButton } from '@/components/ui/action-button'
import { cn } from '@/lib/utils'
import type { EmojiMap } from './emoji-renderer'

export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <ActionButton
      label={t('chat.copy')}
      onClick={handleCopy}
      className="text-muted hover:text-foreground"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </ActionButton>
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
    return <code className="px-1.5 py-0.5 bg-default rounded text-xs" {...props}>{children}</code>
  }

  return (
    <div className="group relative my-3 rounded-lg overflow-hidden bg-card border border-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-default/50 text-xs text-muted">
        <span>{lang ?? 'code'}</span>
        <CopyButton text={code} />
      </div>
      <div className="w-full overflow-x-auto">
        <pre className="p-3 text-xs leading-relaxed !bg-transparent !m-0 w-fit min-w-full">
          <code className={className} {...props}>{children}</code>
        </pre>
      </div>
    </div>
  )
}

export const proseClasses = cn(
  "text-sm leading-relaxed prose prose-invert prose-sm max-w-none",
  "prose-p:my-1.5 prose-headings:mt-4 prose-headings:mb-2",
  // Typography's own first/last reset loses to the heading rules above, so an
  // answer opening on a heading pushes itself away from whatever introduced it.
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
  "prose-pre:p-0 prose-pre:bg-transparent prose-pre:my-0",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-table:text-sm prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5",
  "prose-table:border prose-table:border-border",
  "prose-th:border prose-th:border-border prose-th:bg-default/50",
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

export const MarkdownContent = React.memo(function MarkdownContent({ content, isStreaming, oneBot, emojiMap, className }: { content: string; isStreaming?: boolean; oneBot?: boolean; emojiMap?: EmojiMap; className?: string }) {
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
            className="emoji-sticker rounded"
            {...props}
          />
        )
      }
      return <img alt={alt} src={src} {...props} />
    },
  }), [])

  return (
    <div className={cn(proseClasses, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {processed}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-0.5 bg-muted animate-pulse" />
      )}
    </div>
  )
})
