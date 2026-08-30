import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowsRotateRight,
  Check,
  Copy,
  Microphone,
  Pencil,
  SquareDashedText,
  ThumbsDown,
  ThumbsUp,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons'
import { ModelIcon } from '@/components/ui/model-icon'
import { HostedAgentGlyph } from '@/components/ui/agent-icon'
import { cn } from '@/lib/utils'
import { ActionButton } from '@/components/ui/action-button'
import { useConfirm } from '@/hooks/use-confirm'
import { CopyButton, MarkdownContent } from './markdown-content'
import { Avatar, TextArea } from '@heroui/react'
import {
  MessageAssistant,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
  MessageUser,
} from '@/components/ui/message'
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble'
import { ChatAttachment, ChatAttachmentGroup } from '@heroui-pro/react/chat-attachment'

import { assetSrc } from '@/lib/asset-src'
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtTrigger } from '@heroui-pro/react/chain-of-thought'
import { ChatToolGroup, ChatToolGroupContent, ChatToolGroupTrigger } from '@/components/ui/chat-tool'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { isCoarsePointer, isSubmitKey } from '@/hooks/use-coarse-pointer'
import { SelectTextModal } from './select-text-modal'
import { markQueued } from '@/lib/turns'
import { ToolCallBlock } from './tool-call-block'
import { renderEmojisInText, StickerImage } from './emoji-renderer'
import type { ContentBlock, Message as MessageData, TurnUsageSummary } from '@/types'
import type { SenderNames } from '@/hooks/use-sender-names'
import type { EmojiMap } from './emoji-renderer'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { TurnUsage } from './turn-usage'

/**
 * Who answered and when, sitting level with the avatar at the top of a message.
 *
 * Exported because a collapsed turn hoists this above its collapsed steps: the
 * attribution belongs to the whole turn, and leaving it below the process line
 * would sit it closer to the conclusion than to the avatar it names.
 */
export function MessageMeta({ modelId, createdAt }: { modelId?: string | null; createdAt: number }) {
  const relativeTime = useRelativeTime()
  return (
    // `px-0`: the header's own padding exists to line it up with a padded
    // bubble, and an assistant's is ghost. Left on, the name sits 12px right of
    // both the process line and the answer it names.
    <MessageHeader className="h-8 gap-2 px-0">
      {modelId && <span className="truncate">{modelId}</span>}
      {/* The row is a fixed height, so a long model id has to give way rather
          than push the timestamp out of the message. */}
      <span className="shrink-0 font-normal text-muted">{relativeTime(createdAt)}</span>
    </MessageHeader>
  )
}

/**
 * Who is speaking: the assistant's own picture when it has one, otherwise the
 * logo of the model that wrote the row.
 *
 * `ModelIcon` matches on the model name and falls back to a generic mark of its
 * own, so a model nobody has a logo for still lands as something round rather
 * than a hole. Exported for the same reason as {@link MessageMeta}.
 *
 * **A hosted session is named by its agent, not by its model id.** Neither of
 * the two values above is about it: `src` is this app's default assistant, and
 * `model_id` is whatever the agent reported — Claude Code's default answers
 * `"default"`, a real value that names no model and matches no logo, which is
 * why the row wore an empty circle.
 */
export function AssistantAvatar({
  src,
  modelId,
  hosted,
}: {
  src?: string | null
  modelId?: string | null
  hosted?: boolean
}) {
  return (
    <MessageAvatar className="size-8">
      <Avatar className="size-full">
        {!hosted && <Avatar.Image src={src ?? undefined} />}
        {/* `ModelIcon` brings its own background, so `bg-default` underneath it
            would only show through the rounding. A bare glyph does not, and
            keeps the frame it is dropped into. */}
        <Avatar.Fallback className={hosted ? undefined : 'bg-transparent'}>
          {hosted ? <HostedAgentGlyph /> : <ModelIcon model={modelId ?? undefined} size={32} shape="circle" />}
        </Avatar.Fallback>
      </Avatar>
    </MessageAvatar>
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
  const quoteMatch = remaining.match(/^<quoted_message sender="([^"]+)">([\s\S]*?)<\/quoted_message>\n?/)
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

/**
 * Who to credit above a user bubble.
 *
 * The row stores an id and nothing else, so the nickname is looked up — it
 * changes, and a stored copy would freeze. History written before attribution
 * became structural has no id at all and still carries the old `[nick(id)]`
 * marker in its body, which is what `legacyPrefix` recovers. An id with no
 * nickname on file shows as the bare number: still enough to tell two people
 * apart, which is the whole point.
 */
function speakerLabel(
  senderId: number | null | undefined,
  names: SenderNames | undefined,
  legacyPrefix: string | null,
): string | null {
  if (senderId == null) return legacyPrefix
  return names?.[senderId] ?? String(senderId)
}

function QuotedMessageBlock({ sender, content }: { sender: string; content: string }) {
  return (
    <div className="mb-2 pl-3 border-l-2 border-accent-foreground/30 text-xs text-accent-foreground/70">
      <span className="font-medium">{sender}</span>
      <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap">{content}</p>
    </div>
  )
}

const MemoToolCallBlock = React.memo(ToolCallBlock)

function ThinkingBlock({
  text,
  isStreaming,
  defaultExpanded,
}: {
  text: string
  isStreaming?: boolean
  defaultExpanded?: boolean
}) {
  const { t } = useTranslation()

  return (
    <ChainOfThought defaultExpanded={!!(isStreaming || defaultExpanded)} isStreaming={isStreaming} className="my-2">
      <ChainOfThoughtTrigger>{t('chat.thinking')}</ChainOfThoughtTrigger>
      <ChainOfThoughtContent className="text-xs text-muted leading-relaxed whitespace-pre-wrap">
        {text}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

function TextBubbles({
  content,
  isStreaming,
  oneBot,
  emojiMap,
}: {
  content: string
  isStreaming?: boolean
  oneBot?: boolean
  emojiMap?: EmojiMap
}) {
  // The \n---\n bubble-splitting protocol only exists for OneBot conversations;
  // in normal chats a markdown horizontal rule must stay a single message.
  const segments = oneBot
    ? content
        .split(/\n---\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [content]
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

function AssistantBlock({
  block,
  isLast,
  queued,
  isStreaming,
  isLastMessage,
  oneBot,
  emojiMap,
}: {
  block: ContentBlock
  isLast: boolean
  queued?: boolean
  isStreaming?: boolean
  isLastMessage?: boolean
  oneBot?: boolean
  emojiMap?: EmojiMap
}) {
  if (block.type === 'thinking') {
    return (
      <ThinkingBlock
        text={block.text}
        isStreaming={isLast && isStreaming}
        defaultExpanded={!!isLastMessage && isLast}
      />
    )
  }
  if (block.type === 'text') {
    return <TextBubbles content={block.text} isStreaming={isLast && isStreaming} oneBot={oneBot} emojiMap={emojiMap} />
  }
  if (block.type === 'tool_call') {
    return <MemoToolCallBlock data={block.data} queued={queued} />
  }
  if (block.type === 'sticker') {
    return (
      <div className="my-1 flex justify-start" data-slot="assistant-sticker">
        <StickerImage stickerId={block.sticker_id} name={block.name} />
      </div>
    )
  }
  return null
}

type ToolCallBlockItem = { block: Extract<ContentBlock, { type: 'tool_call' }>; index: number }
type BlockUnit =
  { kind: 'single'; block: ContentBlock; index: number } | { kind: 'tool-group'; items: ToolCallBlockItem[] }

// These render standalone blocks and never join a group: ask_user and
// web_search are interactive, and a checklist folded into "3 tool calls" would
// hide the very thing it exists to show. A hosted agent's two interactive tools
// are the same cards under the names Claude Code gives them, and a form folded
// into "3 tool calls" is a question nobody can answer.
const UNGROUPABLE_TOOLS = new Set([
  'ask_user',
  'AskUserQuestion',
  'web_search',
  'update_todos',
  'enter_plan',
  'exit_plan',
  'ExitPlanMode',
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

function ToolCallGroup({ items, queued }: { items: ToolCallBlockItem[]; queued: boolean[] }) {
  const { t } = useTranslation()
  // One that has not started is not a reason to open the group: the reader would
  // find a card with nothing in it. What opens it is something happening or
  // something being asked.
  const hasActive = items.some(
    ({ block, index }) =>
      !queued[index] &&
      (block.data.status === 'pending' || block.data.status === 'approved' || block.data.status === 'running'),
  )
  return (
    <ChatToolGroup defaultExpanded={hasActive} className="my-3">
      <ChatToolGroupTrigger>{t('chat.tool.groupCount', { count: items.length })}</ChatToolGroupTrigger>
      <ChatToolGroupContent>
        {items.map(({ block, index }) => (
          <MemoToolCallBlock key={index} data={block.data} queued={queued[index]} className="my-0" />
        ))}
      </ChatToolGroupContent>
    </ChatToolGroup>
  )
}

function AssistantBlocks({
  blocks,
  isStreaming,
  isLastMessage,
  oneBot,
  emojiMap,
}: {
  blocks: ContentBlock[]
  isStreaming?: boolean
  isLastMessage?: boolean
  oneBot?: boolean
  emojiMap?: EmojiMap
}) {
  // Web-search-only turns keep their thinking hidden (the summary text is the answer).
  const hasWebSearch = blocks.some((b) => b.type === 'tool_call' && b.data.tool_name === 'web_search')
  const hasText = blocks.some((b) => b.type === 'text' && b.text.trim())
  const filtered = hasWebSearch && !hasText ? blocks.filter((b) => b.type !== 'thinking') : blocks
  const units = groupBlocks(filtered)
  // Indexed against `filtered`, which is what every unit's `index` refers to.
  const queued = markQueued(filtered.map((b) => (b.type === 'tool_call' ? b.data.status : null)))

  return (
    <>
      {units.map((unit) =>
        unit.kind === 'tool-group' ? (
          <ToolCallGroup key={`g${unit.items[0].index}`} items={unit.items} queued={queued} />
        ) : (
          <AssistantBlock
            key={unit.index}
            block={unit.block}
            isLast={unit.index === filtered.length - 1}
            queued={queued[unit.index]}
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
  sticker_id?: string
  name?: string
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
  /** Nicknames for the ids on user rows. Only a group has more than one. */
  senderNames?: SenderNames
  assistantAvatar?: string | null
  /** First row of a run of answers from the same model: carries the avatar and
   *  the header naming it, where the rows after it only indent to match. */
  isFirstInGroup?: boolean
  /** Off for the row that concludes a collapsed turn: the avatar already marks
   *  the top of that turn, above the collapsed region, and drawing a second one
   *  here would read as a second speaker. Defaults to `isFirstInGroup`, which
   *  is where the header naming the model sits. */
  showAvatar?: boolean
  /** Off for the intermediate rows of a turn, whose actions all live on the
   *  turn's conclusion instead — rating a "let me check that" step would only
   *  muddy the feedback, and every regenerate button in a turn does the same
   *  thing anyway. */
  showFooter?: boolean
  /** Totals for the whole turn. The row owning the footer is the only one left
   *  showing a count, so without this it would report just its own usage. */
  tokenTotals?: { input: number | null; output: number | null }
  /** Backend-priced summary for the whole turn. It deliberately travels with
   *  `tokenTotals`: the one row that owns the actions also owns the usage
   *  disclosure, while intermediate rows stay quiet. */
  turnUsage?: TurnUsageSummary | null
  /** Renders these instead of the message's own blocks. A collapsed turn shows
   *  its conclusion through this row, and the steps that led there are already
   *  drawn inside the collapsed region. */
  blocksOverride?: ContentBlock[]
}

export const MessageItem = React.memo(function MessageItem({
  message,
  isStreaming,
  isLastMessage,
  onDelete,
  onRegenerate,
  onEdit,
  onRate,
  isOneBot,
  emojiMap,
  senderNames,
  assistantAvatar,
  isFirstInGroup = true,
  showAvatar,
  showFooter = true,
  tokenTotals,
  turnUsage,
  blocksOverride,
}: MessageItemProps) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'
  const footerTokens = tokenTotals ?? { input: message.input_tokens, output: message.output_tokens }
  const renderBlocks = blocksOverride ?? message._blocks

  // User messages with attachments are stored as a JSON array of parts. Only
  // treat the content as multimodal when every element actually looks like a
  // part; arbitrary text such as "[null]" or "[1,2,3]" must stay plain text.
  const parsedUser = useMemo(() => {
    let contentParts: UserContentPart[] | null = null
    let textContent = message.content
    let copyText = message.content
    if (message.role === 'user' && message.content.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(message.content)
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((p) => typeof p === 'object' && p !== null && typeof (p as { type?: unknown }).type === 'string')
        ) {
          contentParts = parsed as UserContentPart[]
          textContent = contentParts
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join('\n')
          // Copy what the row communicates, not the storage envelope. Raw
          // multimodal JSON exposes local asset URLs and makes a sticker-only
          // message copy as an implementation detail instead of its name.
          copyText = contentParts
            .flatMap((part) => {
              if (part.type === 'text') return part.text ?? ''
              if (part.type === 'file') return part.file?.name ?? ''
              if (part.type === 'sticker') return part.name ?? ''
              return ''
            })
            .filter(Boolean)
            .join('\n')
        }
      } catch {
        /* not JSON, treat as plain text */
      }
    }
    return { contentParts, copyText, textContent }
  }, [message.role, message.content])
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const editRef = useRef<HTMLTextAreaElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const restoreEditFocus = useRef(false)
  const [selectedText, setSelectedText] = useState('')
  const [showSelectText, setShowSelectText] = useState(false)
  // Evaluated once per render rather than stored: `matchMedia` is synchronous
  // and a device does not grow a mouse mid-conversation.
  const coarse = isCoarsePointer()

  const { confirm, confirmDialog } = useConfirm()
  const requestDelete = useCallback(async () => {
    if (await confirm({ body: t('confirm.deleteMessage') })) onDelete?.(message.id)
  }, [confirm, t, onDelete, message.id])

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
      return
    }
    if (restoreEditFocus.current) {
      restoreEditFocus.current = false
      editButtonRef.current?.focus()
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
    restoreEditFocus.current = true
    setEditing(false)
  }, [editText, message.content, message.id, onEdit])

  const handleCancelEdit = useCallback(() => {
    restoreEditFocus.current = true
    setEditing(false)
  }, [])

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancelEdit()
      } else if (isSubmitKey(e)) {
        e.preventDefault()
        handleSaveEdit()
      }
    },
    [handleCancelEdit, handleSaveEdit],
  )

  if (isUser) {
    const { contentParts, copyText, textContent } = parsedUser
    const canEdit = !!onEdit && !contentParts
    const { senderPrefix, quotedMessage, body } = isOneBot
      ? parseOneBotContent(textContent)
      : { senderPrefix: null, quotedMessage: null, body: textContent }
    const speaker = isOneBot ? speakerLabel(message.sender_id, senderNames, senderPrefix) : null

    const hasAttachments = !!contentParts && contentParts.some((p) => p.type === 'image_url' || p.type === 'file')

    const userContent = (
      <ContextMenu onOpenChange={handleContextMenuOpenChange}>
        {/* No `MessageContent` here: with nothing beside it, the message's own
            parts are the column. */}
        <ContextMenuTrigger render={<MessageUser className="pointer-coarse:select-none" />}>
          <>
            {speaker && <MessageHeader className="justify-end text-muted font-normal">{speaker}</MessageHeader>}
            {hasAttachments && (
              <ChatAttachmentGroup className="max-w-[80%] justify-end">
                {contentParts!
                  .filter((p) => p.type === 'image_url')
                  .map((p, i) => (
                    <ChatAttachment
                      key={`img-${i}`}
                      mediaType="image"
                      name={t('chat.attachedImage')}
                      src={assetSrc(p.image_url?.url)}
                    />
                  ))}
                {contentParts!
                  .filter((p) => p.type === 'file')
                  .map((p, i) => (
                    <ChatAttachment key={`file-${i}`} name={p.file?.name ?? 'file'} />
                  ))}
              </ChatAttachmentGroup>
            )}
            {editing ? (
              // Full width while editing. A bubble is sized to what it says, but
              // an edit box is sized to what you are about to say — and the
              // 80% cap turned a message being rewritten into a narrow column
              // with the text reflowing under the caret.
              <Bubble align="end" variant="outline" className="w-full max-w-full">
                <BubbleContent>
                  <TextArea
                    fullWidth
                    ref={editRef}
                    aria-label={t('chat.editMessage')}
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
                    <ActionButton label={t('chat.cancelEdit')} onClick={handleCancelEdit} className="text-muted">
                      <Xmark className="w-3.5 h-3.5" />
                    </ActionButton>
                    <ActionButton label={t('chat.saveEdit')} onClick={handleSaveEdit} className="text-accent">
                      <Check className="w-3.5 h-3.5" />
                    </ActionButton>
                  </div>
                </BubbleContent>
              </Bubble>
            ) : (
              <>
                {(body || quotedMessage || message.source === 'voice') && (
                  <Bubble align="end" variant="default">
                    <BubbleContent>
                      {quotedMessage && (
                        <QuotedMessageBlock sender={quotedMessage.sender} content={quotedMessage.content} />
                      )}
                      <div className="whitespace-pre-wrap">
                        {message.source === 'voice' && (
                          <Microphone
                            className="inline-block size-3.5 mr-1 -mt-0.5 opacity-60"
                            aria-label={t('chat.voice.badge')}
                          />
                        )}
                        {emojiMap && Object.keys(emojiMap).length > 0 ? renderEmojisInText(body, emojiMap) : body}
                      </div>
                    </BubbleContent>
                  </Bubble>
                )}
                {contentParts
                  ?.filter((part) => part.type === 'sticker' && part.sticker_id)
                  .map((part, index) => (
                    <div key={`sticker-${index}`} className="flex justify-end py-1" data-slot="user-sticker">
                      <StickerImage stickerId={part.sticker_id!} name={part.name} />
                    </div>
                  ))}
                <MessageFooter className="gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 pointer-coarse:opacity-100">
                  {canEdit && (
                    <ActionButton
                      ref={editButtonRef}
                      label={t('chat.edit')}
                      onClick={handleStartEdit}
                      className="text-muted hover:text-foreground"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </ActionButton>
                  )}
                  <CopyButton text={copyText} />
                  {onDelete && (
                    <ActionButton
                      label={t('chat.delete')}
                      onClick={requestDelete}
                      className="text-muted hover:text-danger"
                    >
                      <TrashBin className="w-3.5 h-3.5" />
                    </ActionButton>
                  )}
                </MessageFooter>
              </>
            )}
          </>
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
          {canEdit && (
            <ContextMenuItem onClick={handleStartEdit}>
              <Pencil />
              {t('chat.edit')}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => navigator.clipboard.writeText(copyText)}>
            <Copy />
            {t('chat.copy')}
          </ContextMenuItem>
          {coarse && (
            <ContextMenuItem onClick={() => setShowSelectText(true)}>
              <SquareDashedText />
              {t('contextMenu.selectText')}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          {onDelete && (
            <ContextMenuItem variant="destructive" onClick={requestDelete}>
              <TrashBin />
              {t('chat.delete')}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )

    return (
      <>
        {userContent}
        {coarse && <SelectTextModal text={copyText} isOpen={showSelectText} onOpenChange={setShowSelectText} />}
        {confirmDialog}
      </>
    )
  }

  const assistantContent = (
    <ContextMenu onOpenChange={handleContextMenuOpenChange}>
      <ContextMenuTrigger render={<MessageAssistant className="pointer-coarse:select-none" />}>
        {(showAvatar ?? isFirstInGroup) ? (
          <AssistantAvatar src={assistantAvatar} modelId={message.model_id} />
        ) : (
          <div className="min-w-8 shrink-0" />
        )}
        <MessageContent>
          {isFirstInGroup && <MessageMeta modelId={message.model_id} createdAt={message.created_at} />}

          <Bubble variant="ghost" className="w-full">
            <BubbleContent className="w-full">
              {renderBlocks && renderBlocks.length > 0 ? (
                <AssistantBlocks
                  blocks={renderBlocks}
                  isStreaming={isStreaming}
                  isLastMessage={isLastMessage}
                  oneBot={isOneBot}
                  emojiMap={emojiMap}
                />
              ) : blocksOverride ? null : (
                <MarkdownContent
                  content={message.content}
                  isStreaming={isStreaming}
                  oneBot={isOneBot}
                  emojiMap={emojiMap}
                />
              )}
            </BubbleContent>
          </Bubble>

          {showFooter && (
            <MessageFooter className="gap-2 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 pointer-coarse:opacity-100">
              {/* Printed, not counted up to. The number is settled by the time the
                footer exists, and the footer only appears on hover — so the
                animation ran while the reader looked at a finished total, and
                made it read as still being worked out. */}
              <TurnUsage tokens={footerTokens} usage={turnUsage} />
              <div className="flex gap-1">
                <CopyButton text={message.content} />
                {onRate && !isStreaming && (
                  <>
                    <ActionButton
                      label={t('chat.thumbsUp')}
                      aria-pressed={message.rating === 1}
                      onClick={() => onRate(message.id, message.rating === 1 ? null : 1)}
                      className={cn(
                        message.rating === 1 ? 'text-success-soft-foreground' : 'text-muted hover:text-foreground',
                      )}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </ActionButton>
                    <ActionButton
                      label={t('chat.thumbsDown')}
                      aria-pressed={message.rating === -1}
                      onClick={() => onRate(message.id, message.rating === -1 ? null : -1)}
                      className={cn(message.rating === -1 ? 'text-danger' : 'text-muted hover:text-foreground')}
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </ActionButton>
                  </>
                )}
                {onRegenerate && !isStreaming && (
                  <ActionButton
                    label={t('chat.regenerate')}
                    onClick={() => onRegenerate(message.id)}
                    className="text-muted hover:text-foreground"
                  >
                    <ArrowsRotateRight className="w-3.5 h-3.5" />
                  </ActionButton>
                )}
                {onDelete && (
                  <ActionButton
                    label={t('chat.delete')}
                    onClick={requestDelete}
                    className="text-muted hover:text-danger"
                  >
                    <TrashBin className="w-3.5 h-3.5" />
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
        {coarse && (
          <ContextMenuItem onClick={() => setShowSelectText(true)}>
            <SquareDashedText />
            {t('contextMenu.selectText')}
          </ContextMenuItem>
        )}
        {onRate && !isStreaming && (
          <>
            <ContextMenuItem onClick={() => onRate(message.id, message.rating === 1 ? null : 1)}>
              <ThumbsUp className={message.rating === 1 ? 'text-success-soft-foreground' : ''} />
              {t('chat.thumbsUp')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRate(message.id, message.rating === -1 ? null : -1)}>
              <ThumbsDown className={message.rating === -1 ? 'text-danger' : ''} />
              {t('chat.thumbsDown')}
            </ContextMenuItem>
          </>
        )}
        {onRegenerate && !isStreaming && (
          <ContextMenuItem onClick={() => onRegenerate(message.id)}>
            <ArrowsRotateRight />
            {t('chat.regenerate')}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {onDelete && (
          <ContextMenuItem variant="destructive" onClick={requestDelete}>
            <TrashBin />
            {t('chat.delete')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )

  return (
    <>
      {assistantContent}
      {coarse && <SelectTextModal text={message.content} isOpen={showSelectText} onOpenChange={setShowSelectText} />}
      {confirmDialog}
    </>
  )
})
