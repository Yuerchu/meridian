import React, { useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { marked } from 'marked'
import ReactMarkdown, { defaultUrlTransform, type UrlTransform } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { Focusable } from 'react-aria-components'
import { openExternalUrl } from '@/lib/external-link'
import { Check, Copy } from '@keyline-icons/react/two-tone'
import { Link, Skeleton, Tooltip, TooltipTrigger } from '@/components/base'
import type { Components } from 'react-markdown'

import { markdownVariants } from '@/components/base'

import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { ActionButton } from '@/components/ui/action-button'
import { Hint } from '@/components/ui/hint'
import { fileIconUrl, languageIconUrl } from '@/lib/file-icon'
import {
  classifyMarkdownTarget,
  markdownFileCandidateHref,
  markdownFileName,
  markdownFileReferenceHref,
  parseMarkdownFileCandidate,
  remarkFileReferences,
  type MarkdownFileReference,
} from '@/lib/markdown-target'
import { cx } from '@/utils/cx'
import { useFilePreview, type FilePreviewContextValue } from './file-preview-context'
import { ShikiCode } from './shiki-code'
import type { EmojiMap } from './emoji-renderer'

const MarkdownStreamingContext = React.createContext(false)

function reactNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(reactNodeText).join('')
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return reactNodeText(node.props.children)
  return ''
}

function markdownHeadingId(children: React.ReactNode): string {
  return reactNodeText(children)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/gu, '-')
}

function MarkdownHeading({
  as: Heading,
  children,
  node: _node,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  as: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  node?: unknown
}) {
  return (
    <Heading {...props} id={markdownHeadingId(children)}>
      {children}
    </Heading>
  )
}

const MarkdownH1: Components['h1'] = (props) => <MarkdownHeading as="h1" {...props} />
const MarkdownH2: Components['h2'] = (props) => <MarkdownHeading as="h2" {...props} />
const MarkdownH3: Components['h3'] = (props) => <MarkdownHeading as="h3" {...props} />
const MarkdownH4: Components['h4'] = (props) => <MarkdownHeading as="h4" {...props} />
const MarkdownH5: Components['h5'] = (props) => <MarkdownHeading as="h5" {...props} />
const MarkdownH6: Components['h6'] = (props) => <MarkdownHeading as="h6" {...props} />

function referenceLabel(reference: MarkdownFileReference): string {
  const line = reference.line
    ? `:${reference.line}${reference.endLine ? `-${reference.endLine}` : ''}${reference.column ? `:${reference.column}` : ''}`
    : ''
  return `${reference.path}${line}`
}

function FileReferenceButton({ reference }: { reference: MarkdownFileReference }) {
  const preview = useFilePreview()
  const icon = fileIconUrl(reference.path)
  const label = referenceLabel(reference)

  return (
    <TooltipTrigger delay={0}>
      <Link
        data-slot="markdown-file-reference"
        aria-label={label}
        isDisabled={!preview}
        onPress={() => preview?.openPreview(reference)}
        className="mx-0.5 inline-flex min-w-0 max-w-full gap-1 rounded-md px-1.5 py-0.5 align-baseline font-mono text-caption-1-regular"
      >
        {icon && (
          <img data-slot="markdown-file-reference-icon" src={icon} alt="" aria-hidden className="size-3.5 shrink-0" />
        )}
        <span data-slot="markdown-file-reference-name" className="truncate">
          {markdownFileName(reference.path)}
        </span>
      </Link>
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  )
}

function CandidateFileReference({
  reference,
  children,
}: {
  reference: MarkdownFileReference
  children: React.ReactNode
}) {
  const preview = useFilePreview()
  const [verified, setVerified] = React.useState<{
    owner: FilePreviewContextValue
    path: string
  } | null>(null)

  React.useEffect(() => {
    if (!preview) return
    let live = true
    void preview.probeReference(reference.path).then(
      (exists) => {
        if (live) setVerified(exists ? { owner: preview, path: reference.path } : null)
      },
      () => {
        if (live) setVerified(null)
      },
    )
    return () => {
      live = false
    }
  }, [preview, reference.path])

  if (preview && verified?.owner === preview && verified.path === reference.path) {
    return <FileReferenceButton reference={reference} />
  }
  return <>{children}</>
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation()
  const [copied, markCopied] = useTemporaryFlag()
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    markCopied()
  }, [text, markCopied])

  return <ActionButton label={t('chat.copy')} onClick={handleCopy} className={className} icon={copied ? Check : Copy} />
}

function fenceLanguage(className: string | undefined): string {
  return /language-(\w+)/.exec(className ?? '')?.[1] ?? 'plaintext'
}

/**
 * A fenced block, or inline code when it fits on one line.
 *
 * The line test comes from the old renderer's own logic, and is what the old
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
  const isStreaming = React.useContext(MarkdownStreamingContext)
  const start = node?.position?.start.line
  if (!start || start === node?.position?.end.line) {
    const value = String(children ?? '').trim()
    const reference = !isStreaming ? parseMarkdownFileCandidate(value) : null
    const fallback = (
      // No classes of its own: the prose recipe's `prose-code:` variants
      // (`markdown-variants.tsx`) outrank anything written here, so a fill or
      // a size on this element was dead the whole time.
      <code data-slot="markdown-inline-code" className={className} {...props}>
        {children}
      </code>
    )
    return reference ? <CandidateFileReference reference={reference}>{fallback}</CandidateFileReference> : fallback
  }

  const language = fenceLanguage(className)
  const code = String(children ?? '').replace(/\n$/, '')
  const icon = languageIconUrl(language)

  return (
    // The old library's classes without its components: importing `CodeBlock`
    // for its header would drag in `CodeBlock.Code`, and with it Shiki's full
    // entry point — the whole reason `lib/shiki` exists. The stylesheet is
    // already loaded, so the markup below looks the same either way.
    //
    // The radius is ours: the old library's own was 16px, the composer's rung,
    // one above what a card inside the transcript may take.
    //
    // `not-prose`, because the prose recipe reaches the `pre` inside otherwise
    // (`prose-pre:` fill and radius, typography's own padding and margin) and
    // draws a second box inside the block. The block styles itself, in
    // `meridian.css`.
    <div data-slot="markdown-code-block" className="code-block not-prose my-3 rounded-xl">
      <div data-slot="markdown-code-header" className="code-block__header">
        {icon && <img data-slot="markdown-code-icon" src={icon} alt="" aria-hidden className="size-4 shrink-0" />}
        <span data-slot="markdown-code-language" className="text-caption-1-regular text-text-secondary">
          {language}
        </span>
        {/* The only way to copy a single block — the long-press menu copies the
            whole message. The action recipe is already 28px (`size-7`), which
            matters here: `.code-block` is `overflow: clip` for its corners,
            which cuts the expanded hit area back, and 28 drawn pixels are what
            close that gap without moving the button off its corner. */}
        <CopyButton text={code} className="touch-hitbox ms-auto" />
      </div>
      <ShikiCode code={code} language={language} defer={isStreaming} />
    </div>
  )
}

/**
 * A table, with somewhere for it to go when it does not fit.
 *
 * The old `.markdown table` style stopped at `width: 100%`, which is an
 * answer only for a table narrower than its column. Past that the cells stop at
 * their minimum content width and the table runs over the edge — and the bubble
 * around it is `overflow-hidden`, so the columns on the end were not clipped
 * with a scrollbar, they were gone. On a phone that is most tables of more than
 * about three columns.
 *
 * The wrapper scrolls rather than the table wrapping, because a rate card
 * squeezed to one word per cell is unreadable in a different way. `max-w-full`
 * is what makes the scroller narrower than its content: a grid or flex child
 * refuses to shrink past min-content without it, and the overflow simply moves
 * up one level.
 */
const TableBlock: Components['table'] = ({ children, ...props }) => (
  <div data-slot="markdown-table" className="my-3 max-w-full overflow-x-auto">
    <table data-slot="markdown-table-element" {...props}>
      {children}
    </table>
  </div>
)

/**
 * The old defaults set `list-inside`, which tucks a wrapped list item under
 * its own marker, and sized `h3` at the body size. Both are fine for a short
 * answer and wrong for a long one, which is most of what lands here.
 */
const markdownClasses = cx(
  'text-body-regular leading-relaxed',
  '[&_ul]:list-outside [&_ul]:ps-5 [&_ol]:list-outside [&_ol]:ps-5',
  '[&_h3]:text-headline-regular',
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

const BASE_REMARK_PLUGINS = [remarkGfm, remarkBreaks]
const FILE_REMARK_PLUGINS = [remarkGfm, remarkBreaks, remarkFileReferences]

const markdownUrlTransform: UrlTransform = (url, key, _node) => {
  if (key !== 'href') return defaultUrlTransform(url)
  const target = classifyMarkdownTarget(url)
  if (target.kind === 'external') return target.url
  if (target.kind === 'file') return markdownFileReferenceHref(target.reference)
  if (target.kind === 'file-candidate') return markdownFileCandidateHref(target.reference)
  if (target.kind === 'fragment') return url
  // ReactMarkdown treats a null result as an empty URL. The custom anchor
  // below turns that into inert text, so no unknown scheme can escape through
  // native WebView navigation.
  return null
}

const MarkdownAnchor: Components['a'] = ({ href, children, node: _node, ...props }) => {
  const target = classifyMarkdownTarget(href)
  if (target.kind === 'file') return <FileReferenceButton reference={target.reference} />
  if (target.kind === 'file-candidate') {
    return <CandidateFileReference reference={target.reference}>{children}</CandidateFileReference>
  }
  if (target.kind === 'unsupported') return <span data-slot="markdown-unsupported-link">{children}</span>

  const activate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (target.kind === 'external') {
      void openExternalUrl(target.url)
      return
    }
    if (target.kind === 'fragment') {
      // Scope the fragment to this rendered message. Different assistant
      // messages routinely reuse headings such as "Tests"; document-wide
      // lookup would jump into whichever message happened to render first.
      const root = event.currentTarget.closest('[data-slot="markdown"]')
      const destination = Array.from(root?.querySelectorAll<HTMLElement>('[id]') ?? []).find(
        (candidate) => candidate.id === target.id,
      )
      destination?.scrollIntoView({ block: 'start' })
    }
  }

  const anchorProps: React.ComponentProps<'a'> = {
    ...props,
    // Keep the real external URL out of `href`: WebView context-menu and
    // drag navigation do not pass through React's click handlers. The
    // closure below is the only activation path and hands it to the native
    // opener after classification.
    href: target.kind === 'external' ? '#meridian-external' : `#${target.id}`,
    'data-external-href': target.kind === 'external' ? target.url : undefined,
    rel: 'noreferrer noopener',
    onClick: activate,
    onAuxClick: (event) => {
      // Middle-click is a separate default navigation path in WebView2.
      event.preventDefault()
      if (event.button === 1 && target.kind === 'external') void openExternalUrl(target.url)
    },
  } as React.ComponentProps<'a'>

  if (target.kind !== 'external') {
    return (
      <a data-slot="markdown-link" {...anchorProps}>
        {children}
      </a>
    )
  }

  // `Focusable` is what lets the anchor receive the trigger's hover and focus
  // handlers, which React Aria hands down through context: a bare `<a>` never
  // opened the tooltip — and the tooltip is the only place the real URL is
  // shown, the visible `href` being a sentinel.
  return (
    <TooltipTrigger delay={300}>
      <Focusable>
        <a data-slot="markdown-external-link" role="link" {...anchorProps}>
          {children}
        </a>
      </Focusable>
      <Tooltip placement="top" className="max-w-xs break-all">
        {target.url}
      </Tooltip>
    </TooltipTrigger>
  )
}

function blockHash(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index++) hash = Math.imul(31, hash) + value.charCodeAt(index)
  return (hash >>> 0).toString(36)
}

const MemoizedMarkdownBlock = React.memo(function MemoizedMarkdownBlock({
  content,
  components,
  autoFileReferences,
}: {
  content: string
  components: Partial<Components>
  autoFileReferences: boolean
}) {
  const slots = useMemo(() => markdownVariants(), [])
  return (
    <div data-slot="markdown-block" className={slots.block()}>
      <ReactMarkdown
        components={components}
        remarkPlugins={autoFileReferences ? FILE_REMARK_PLUGINS : BASE_REMARK_PLUGINS}
        urlTransform={markdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

/**
 * The paragraph a trailer is floated into.
 *
 * `flow-root` so the paragraph contains its own float: without it the float
 * hangs below the paragraph's box, and since the bubble around it clips
 * overflow, the time would be cut off at the bubble's bottom padding.
 */
function TrailedParagraph({
  trailer,
  children,
  node: _node,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & { trailer: React.ReactNode; node?: unknown }) {
  return (
    <p data-slot="markdown-trailed-paragraph" {...props} className={cx('flow-root', props.className)}>
      {children}
      <span data-slot="markdown-trailer" className="float-right ml-2 mt-1.5">
        {trailer}
      </span>
    </p>
  )
}

/** A markdown renderer with one deliberate seam: safe URL and text-node transforms. */
function LocalMarkdown({
  children,
  components,
  id,
  autoFileReferences,
  trailer,
}: {
  children: string
  components: Partial<Components>
  id?: string
  autoFileReferences: boolean
  trailer?: React.ReactNode
}) {
  const generatedId = useId()
  const rendererId = id ?? generatedId
  const slots = useMemo(() => markdownVariants(), [])
  const tokens = useMemo(
    () => marked.lexer(children).map((token) => ({ raw: token.raw, type: token.type })),
    [children],
  )
  const blocks = useMemo(() => {
    const occurrences = new Map<string, number>()
    return tokens.map((token) => {
      const hash = blockHash(token.raw)
      const occurrence = occurrences.get(hash) ?? 0
      occurrences.set(hash, occurrence + 1)
      return { content: token.raw, type: token.type, key: `${rendererId}-${hash}-${occurrence}` }
    })
  }, [tokens, rendererId])

  // Where the trailer goes is decided by the *last* block, and only a
  // paragraph can take it inline: a float placed after a whole block can only
  // ever land on the line after it, never at the end of its last line, so the
  // trailer has to be rendered inside the paragraph's own `<p>`. After a code
  // block, a table or a list it goes on a line of its own — floated into those
  // it would sit inside the box, next to the last row of a table.
  let lastIndex = -1
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type !== 'space') {
      lastIndex = i
      break
    }
  }
  const inline = trailer != null && lastIndex >= 0 && blocks[lastIndex].type === 'paragraph'
  const trailedComponents = useMemo<Partial<Components>>(
    () =>
      inline
        ? {
            ...components,
            p: (props) => <TrailedParagraph {...props} trailer={trailer} />,
          }
        : components,
    [components, inline, trailer],
  )

  return (
    <>
      <div data-slot="markdown" className={slots.base()}>
        {blocks.map((block, i) => (
          <MemoizedMarkdownBlock
            key={block.key}
            content={block.content}
            components={inline && i === lastIndex ? trailedComponents : components}
            autoFileReferences={autoFileReferences}
          />
        ))}
      </div>
      {trailer != null && !inline && (
        <div data-slot="markdown-trailer" className="mt-1 flex justify-end">
          {trailer}
        </div>
      )}
    </>
  )
}

function MarkdownImage({ alt = '', className, onError, onLoad, ...props }: React.ComponentProps<'img'>) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = React.useState(false)

  return (
    <span
      data-slot="markdown-image-frame"
      data-loaded={loaded || undefined}
      role={loaded ? undefined : 'status'}
      aria-busy={loaded ? undefined : true}
      aria-label={loaded ? undefined : t('common.loading')}
      className={cx(
        'relative my-3 block w-fit max-w-full overflow-hidden rounded-lg bg-background-secondary-default/20',
        !loaded && 'min-h-24 min-w-24',
      )}
    >
      <img
        data-slot="markdown-image"
        {...props}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cx(
          'block h-auto max-h-[70svh] max-w-full object-contain transition-opacity motion-reduce:transition-none',
          !loaded && 'opacity-0',
          className,
        )}
        onLoad={(event) => {
          setLoaded(true)
          onLoad?.(event)
        }}
        onError={(event) => {
          setLoaded(true)
          onError?.(event)
        }}
      />
      {!loaded && (
        <Skeleton
          aria-hidden="true"
          className="absolute inset-0"
          render={(props) => (
            <span data-slot="markdown-image-placeholder" {...(props as React.ComponentProps<'span'>)} />
          )}
        />
      )}
    </span>
  )
}

function isRemoteImageSource(source: string | undefined): boolean {
  return source != null && /^(?:https?:|\/\/)/i.test(source)
}

export const MarkdownContent = React.memo(function MarkdownContent({
  content,
  isStreaming,
  oneBot,
  emojiMap,
  allowRemoteImages = true,
  className,
  blockId,
  trailer,
}: {
  content: string
  isStreaming?: boolean
  oneBot?: boolean
  emojiMap?: EmojiMap
  /** File previews opt out so opening a local README never makes an implicit network request. */
  allowRemoteImages?: boolean
  className?: string
  blockId?: string
  /** Something small to hang off the end of the last line — a bubble's time.
   *  Floated into the final paragraph when there is one, put on its own line
   *  under anything else. Ignored while streaming: the cursor owns that spot,
   *  and a time on a message still being written would be wrong anyway. */
  trailer?: React.ReactNode
}) {
  const processed = useMemo(() => {
    let result = preprocessEmojis(content, emojiMap)
    if (oneBot) result = preprocessMentions(result)
    return result
  }, [content, emojiMap, oneBot])

  const components = useMemo<Partial<Components>>(
    () => ({
      code: CodeBlock,
      pre: ({ children }) => <>{children}</>,
      table: TableBlock,
      h1: MarkdownH1,
      h2: MarkdownH2,
      h3: MarkdownH3,
      h4: MarkdownH4,
      h5: MarkdownH5,
      h6: MarkdownH6,
      img: ({ alt, src, ...props }) => {
        if (!allowRemoteImages && isRemoteImageSource(src)) {
          return (
            <Hint
              data-slot="markdown-blocked-image"
              label={src}
              className="my-3 block max-w-full truncate rounded-lg bg-background-secondary-default/30 px-3 py-2 text-caption-1-regular text-text-secondary"
            >
              {alt}
            </Hint>
          )
        }
        if (alt?.startsWith('sticker:')) {
          return (
            <img
              data-slot="markdown-sticker"
              {...props}
              src={src}
              alt={alt.slice(8)}
              loading="lazy"
              width={48}
              height={48}
              className="emoji-sticker rounded-md"
            />
          )
        }
        return <MarkdownImage {...props} alt={alt ?? ''} src={src} />
      },
      a: MarkdownAnchor,
    }),
    [allowRemoteImages],
  )

  return (
    <div data-slot="markdown-content" className={cx(markdownClasses, className)}>
      {/* `id` seeds the keys of the memoised blocks, so it only has to be unique
          between renderers on screen — the key itself already hashes the block's
          own content. Falls back to a generated one. */}
      <MarkdownStreamingContext value={isStreaming === true}>
        <LocalMarkdown
          components={components}
          id={blockId}
          autoFileReferences={!isStreaming}
          trailer={isStreaming ? null : trailer}
        >
          {processed}
        </LocalMarkdown>
      </MarkdownStreamingContext>
      {isStreaming && (
        <span
          data-slot="markdown-cursor"
          // eslint-disable-next-line no-restricted-syntax -- the streaming caret blinks; it is a cursor, not a placeholder for content
          className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-current text-text-secondary motion-reduce:animate-none"
        />
      )}
    </div>
  )
})
