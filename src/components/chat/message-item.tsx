import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Copy, Check, Trash2, RefreshCw, FileText, Mic, Pencil, X, ThumbsUp, ThumbsDown } from 'lucide-react'
import CountUp from '@/components/CountUp'
import DecryptedText from '@/components/DecryptedText'
import { cn } from '@/lib/utils'
import { ActionButton } from '@/components/ui/action-button'
import { CopyButton, MarkdownContent } from './markdown-content'
import { Textarea } from '@/components/ui/textarea'
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
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtTrigger,
} from '@/components/ui/chain-of-thought'
import {
  ChatToolGroup,
  ChatToolGroupContent,
  ChatToolGroupTrigger,
} from '@/components/ui/chat-tool'
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
import { convertFileSrc } from '@tauri-apps/api/core'
import { isSubmitKey } from '@/hooks/use-coarse-pointer'
import { ToolCallBlock } from './tool-call-block'
import { renderEmojisInText } from './emoji-renderer'
import type { ContentBlock, Message as MessageData } from '@/types'
import type { EmojiMap } from './emoji-renderer'

// Attachment URLs are stored as file:// URIs, but the WebView runs on an http
// origin and blocks file:// subresources. Map them through the asset protocol.
function assetSrc(url?: string): string | undefined {
  if (!url) return undefined
  if (!url.startsWith('file://')) return url
  let path = url.slice('file://'.length)
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  return convertFileSrc(decodeURIComponent(path))
}

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


const MemoToolCallBlock = React.memo(ToolCallBlock)

function ThinkingBlock({ text, isStreaming, defaultExpanded }: { text: string; isStreaming?: boolean; defaultExpanded?: boolean }) {
  const { t } = useTranslation()

  return (
    <ChainOfThought defaultOpen={!!(isStreaming || defaultExpanded)} isStreaming={isStreaming} className="my-2">
      <ChainOfThoughtTrigger>{t('chat.thinking')}</ChainOfThoughtTrigger>
      <ChainOfThoughtContent className="text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
        {text}
      </ChainOfThoughtContent>
    </ChainOfThought>
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

type ToolCallBlockItem = { block: Extract<ContentBlock, { type: 'tool_call' }>; index: number }
type BlockUnit =
  | { kind: 'single'; block: ContentBlock; index: number }
  | { kind: 'tool-group'; items: ToolCallBlockItem[] }

// These render standalone blocks and never join a group: ask_user and
// web_search are interactive, and a checklist folded into "3 tool calls" would
// hide the very thing it exists to show.
const UNGROUPABLE_TOOLS = new Set([
  'ask_user',
  'web_search',
  'update_todos',
  'enter_plan',
  'exit_plan',
])

function isGroupableToolCall(block: ContentBlock): block is Extract<ContentBlock, { type: 'tool_call' }> {
  return block.type === 'tool_call' && !UNGROUPABLE_TOOLS.has(block.data.tool_name)
}

function groupBlocks(blocks: ContentBlock[]): BlockUnit[] {
  const units: BlockUnit[] = []
  let run: ToolCallBlockItem[] = []
  const flush = () => {
    if (run.length >= 2) {
      units.push({ kind: 'tool-group', items: run })
    } else {
      for (const item of run) units.push({ kind: 'single', block: item.block, index: item.index })
    }
    run = []
  }
  blocks.forEach((block, index) => {
    if (isGroupableToolCall(block)) {
      run.push({ block, index })
    } else {
      flush()
      units.push({ kind: 'single', block, index })
    }
  })
  flush()
  return units
}

function ToolCallGroup({ items }: { items: ToolCallBlockItem[] }) {
  const { t } = useTranslation()
  const hasActive = items.some(({ block }) =>
    block.data.status === 'pending' || block.data.status === 'approved' || block.data.status === 'running',
  )
  return (
    <ChatToolGroup defaultOpen={hasActive} className="my-3">
      <ChatToolGroupTrigger>{t('chat.tool.groupCount', { count: items.length })}</ChatToolGroupTrigger>
      <ChatToolGroupContent>
        {items.map(({ block, index }) => (
          <MemoToolCallBlock key={index} data={block.data} className="my-0" />
        ))}
      </ChatToolGroupContent>
    </ChatToolGroup>
  )
}

function AssistantBlocks({ blocks, isStreaming, isLastMessage, oneBot, emojiMap }: { blocks: ContentBlock[]; isStreaming?: boolean; isLastMessage?: boolean; oneBot?: boolean; emojiMap?: EmojiMap }) {
  // Web-search-only turns keep their thinking hidden (the summary text is the answer).
  const hasWebSearch = blocks.some((b) => b.type === 'tool_call' && b.data.tool_name === 'web_search')
  const hasText = blocks.some((b) => b.type === 'text' && b.text.trim())
  const filtered = hasWebSearch && !hasText ? blocks.filter((b) => b.type !== 'thinking') : blocks
  const units = groupBlocks(filtered)

  return (
    <>
      {units.map((unit) =>
        unit.kind === 'tool-group' ? (
          <ToolCallGroup key={`g${unit.items[0].index}`} items={unit.items} />
        ) : (
          <AssistantBlock
            key={unit.index}
            block={unit.block}
            isLast={unit.index === filtered.length - 1}
            isStreaming={isStreaming}
            isLastMessage={isLastMessage}
            oneBot={oneBot}
            emojiMap={emojiMap}
          />
        ),
      )}
    </>
  )
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
  /** Off for the intermediate rows of a turn, whose actions all live on the
   *  turn's conclusion instead — rating a "let me check that" step would only
   *  muddy the feedback, and every regenerate button in a turn does the same
   *  thing anyway. */
  showFooter?: boolean
  /** Totals for the whole turn. The row owning the footer is the only one left
   *  showing a count, so without this it would report just its own usage. */
  tokenTotals?: { input: number | null; output: number | null }
  /** Renders these instead of the message's own blocks. A collapsed turn shows
   *  its conclusion through this row, and the steps that led there are already
   *  drawn inside the collapsed region. */
  blocksOverride?: ContentBlock[]
}

export const MessageItem = React.memo(function MessageItem({ message, isStreaming, isLastMessage, onDelete, onRegenerate, onEdit, onRate, isOneBot, emojiMap, assistantAvatar, isFirstInGroup = true, isLastInGroup = true, showFooter = true, tokenTotals, blocksOverride }: MessageItemProps) {
  const { t } = useTranslation()
  const relativeTime = useRelativeTime()
  const isUser = message.role === 'user'
  const footerTokens = tokenTotals ?? { input: message.input_tokens, output: message.output_tokens }
  const renderBlocks = blocksOverride ?? message._blocks

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
                      <img src={assetSrc(p.image_url?.url)} alt="" />
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
                  <Textarea
                    ref={editRef}
                    value={editText}
                    onChange={(e) => {
                      setEditText(e.target.value)
                      e.target.style.height = 'auto'
                      e.target.style.height = e.target.scrollHeight + 'px'
                    }}
                    onKeyDown={handleEditKeyDown}
                    className="w-full min-w-[200px] min-h-0 rounded-none border-0 p-0 field-sizing-fixed bg-transparent dark:bg-transparent text-sm leading-relaxed resize-none outline-none focus-visible:ring-0"
                    rows={1}
                  />
                  <div className="flex justify-end gap-1 mt-1.5">
                    <ActionButton
                      label="Esc"
                      onClick={handleCancelEdit}
                      className="text-muted-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </ActionButton>
                    <ActionButton
                      label="Enter"
                      onClick={handleSaveEdit}
                      className="text-primary"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </ActionButton>
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
                      {message.source === 'voice' && (
                        <Mic className="inline-block size-3 mr-1 -mt-0.5 opacity-60" aria-label={t('chat.voice.badge')} />
                      )}
                      {emojiMap && Object.keys(emojiMap).length > 0
                        ? renderEmojisInText(body, emojiMap)
                        : body}
                    </div>
                  </BubbleContent>
                </Bubble>
                <MessageFooter className="gap-1 opacity-0 group-hover/message:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                  {onEdit && (
                    <ActionButton
                      label={t('chat.edit')}
                      onClick={handleStartEdit}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </ActionButton>
                  )}
                  <CopyButton text={message.content} />
                  {onDelete && (
                    <ActionButton
                      label={t('chat.delete')}
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </ActionButton>
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
              {(renderBlocks && renderBlocks.length > 0) ? (
                <AssistantBlocks blocks={renderBlocks} isStreaming={isStreaming} isLastMessage={isLastMessage} oneBot={isOneBot} emojiMap={emojiMap} />
              ) : blocksOverride ? null : (
                <MarkdownContent content={message.content} isStreaming={isStreaming} oneBot={isOneBot} emojiMap={emojiMap} />
              )}
            </BubbleContent>
          </Bubble>

          {showFooter && (
          <MessageFooter className="gap-1 opacity-0 group-hover/message:opacity-100 pointer-coarse:opacity-100 transition-opacity">
            {(footerTokens.input || footerTokens.output) && (
              <span className="text-xs text-muted-foreground/50 mr-1 font-normal">
                {footerTokens.input && footerTokens.output
                  ? <><CountUp to={footerTokens.input} separator="," duration={1} /> + <CountUp to={footerTokens.output} separator="," duration={1} /> tokens</>
                  : <><CountUp to={(footerTokens.output ?? footerTokens.input)!} separator="," duration={1} /> tokens</>}
              </span>
            )}
            <div className="flex gap-1">
              <CopyButton text={message.content} />
              {onRate && !isStreaming && (
                <>
                  <ActionButton
                    label={t('chat.thumbsUp')}
                    onClick={() => onRate(message.id, message.rating === 1 ? null : 1)}
                    className={cn(
                      message.rating === 1 ? 'text-success' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                  </ActionButton>
                  <ActionButton
                    label={t('chat.thumbsDown')}
                    onClick={() => onRate(message.id, message.rating === -1 ? null : -1)}
                    className={cn(
                      message.rating === -1 ? 'text-destructive' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                  </ActionButton>
                </>
              )}
              {onRegenerate && !isStreaming && (
                <ActionButton
                  label={t('chat.regenerate')}
                  onClick={() => onRegenerate(message.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </ActionButton>
              )}
              {onDelete && (
                <ActionButton
                  label={t('chat.delete')}
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </ActionButton>
              )}
            </div>
          </MessageFooter>
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
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(message.content)}>
          <Copy />
          {t('chat.copy')}
        </ContextMenuItem>
        {onRate && !isStreaming && (
          <>
            <ContextMenuItem onClick={() => onRate(message.id, message.rating === 1 ? null : 1)}>
              <ThumbsUp className={message.rating === 1 ? 'text-success' : ''} />
              {t('chat.thumbsUp')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRate(message.id, message.rating === -1 ? null : -1)}>
              <ThumbsDown className={message.rating === -1 ? 'text-destructive' : ''} />
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
