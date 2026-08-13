import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import { Check, Copy } from '@gravity-ui/icons'
import type { Components } from 'react-markdown'

import { Markdown as ProMarkdown } from '@heroui-pro/react/markdown'

import { ActionButton } from '@/components/ui/action-button'
import { languageIconUrl } from '@/lib/file-icon'
import { cn } from '@/lib/utils'
import { ShikiCode } from './shiki-code'
import type { EmojiMap } from './emoji-renderer'

export function CopyButton({ text, className }: { text: string; className?: string }) {
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
      className={cn('text-muted hover:text-foreground', className)}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </ActionButton>
  )
}

function fenceLanguage(className: string | undefined): string {
  return /language-(\w+)/.exec(className ?? '')?.[1] ?? 'plaintext'
}

/**
 * A fenced block, or inline code when it fits on one line.
 *
 * The line test comes from Pro's own renderer, and is what the old
 * `!className && !code.includes('\n')` guess was standing in for: a fence
 * without a language has no className either, so the two cases were only ever
 * distinguishable by their newline. The position is exact.
 *
 * The header carries the language's file icon rather than spelling the name in
 * capitals — the icon pack is already loaded for the file tree, and a shape is
 * quicker to read than `TYPESCRIPT`. The name stays next to it for the
 * languages whose icon is generic.
 */
const CodeBlock: Components['code'] = ({ className, children, node, ...props }) => {
  const start = node?.position?.start.line
  if (!start || start === node?.position?.end.line) {
    return <code className={cn('rounded bg-default px-1.5 py-0.5 text-xs', className)} {...props}>{children}</code>
  }

  const language = fenceLanguage(className)
  const code = String(children ?? '').replace(/\n$/, '')
  const icon = languageIconUrl(language)

  return (
    // Pro's classes without Pro's components: importing `CodeBlock` for its
    // header would drag in `CodeBlock.Code`, and with it Shiki's full entry
    // point — the whole reason `lib/shiki` exists. The stylesheet is already
    // loaded, so the markup below looks the same either way.
    //
    // The radius is ours: Pro's own is 16px, the composer's rung, one above
    // what a card inside the transcript may take.
    <div data-slot="markdown-code-block" className="code-block my-3 rounded-xl">
      <div data-slot="markdown-code-header" className="code-block__header">
        {icon && <img src={icon} alt="" aria-hidden className="size-4 shrink-0" />}
        <span className="text-xs text-muted">{language}</span>
        <CopyButton text={code} className="ms-auto size-6 rounded-md" />
      </div>
      <ShikiCode code={code} language={language} />
    </div>
  )
}

/**
 * Pro sets `list-inside`, which tucks a wrapped list item under its own marker,
 * and sizes `h3` at the body size. Both are fine for a short answer and wrong
 * for a long one, which is most of what lands here.
 */
const markdownClasses = cn(
  'text-sm leading-relaxed',
  '[&_ul]:list-outside [&_ul]:ps-5 [&_ol]:list-outside [&_ol]:ps-5',
  '[&_h3]:text-base',
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

export const MarkdownContent = React.memo(function MarkdownContent({ content, isStreaming, oneBot, emojiMap, className, blockId }: { content: string; isStreaming?: boolean; oneBot?: boolean; emojiMap?: EmojiMap; className?: string; blockId?: string }) {
  const processed = useMemo(() => {
    let result = preprocessEmojis(content, emojiMap)
    if (oneBot) result = preprocessMentions(result)
    return result
  }, [content, emojiMap, oneBot])

  const components = useMemo<Partial<Components>>(() => ({
    code: CodeBlock,
    img: ({ alt, src, ...props }) => {
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
    // A link in an answer is a link to the web, and this is a WebView: left
    // alone it would navigate the app itself to the page, with no way back.
    a: ({ href, children, ...props }) => {
      const external = !!href && /^https?:/i.test(href)
      return (
        <a
          href={href}
          rel="noreferrer noopener"
          onClick={external ? (e) => { e.preventDefault(); void openExternal(href) } : undefined}
          {...props}
        >
          {children}
        </a>
      )
    },
  }), [])

  return (
    <div className={cn(markdownClasses, className)}>
      {/* `id` seeds the keys of the memoised blocks, so it only has to be unique
          between renderers on screen — the key itself already hashes the block's
          own content. Falls back to a generated one. */}
      <ProMarkdown components={components} id={blockId}>
        {processed}
      </ProMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-0.5 bg-muted animate-pulse" />
      )}
    </div>
  )
})
