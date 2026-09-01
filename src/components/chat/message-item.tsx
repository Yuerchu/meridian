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
  MessageGroupAssistant,
  MessageGroupAvatar,
  MessageGroupBubbles,
  MessageGroupFooter,
  MessageGroupHeader,
  MessageGroupUser,
} from '@/components/ui/message-group'
import { Bubble, BubbleContent, BubbleTime } from '@/components/ui/bubble'
import { BubbleKeyboard } from '@/components/ui/bubble-keyboard'
import { ChatToolPresentationProvider } from '@/components/ui/chat-tool'
import { ChatAttachment, ChatAttachmentGroup } from '@heroui-pro/react/chat-attachment'
import { ErrorBoundary } from '@/components/error-boundary'

import { assetSrc } from '@/lib/asset-src'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { isCoarsePointer, isSubmitKey } from '@/hooks/use-coarse-pointer'
import { useClockTime } from '@/hooks/use-clock-time'
import { SelectTextModal } from './select-text-modal'
import { ToolCallBlock } from './tool-call-block'
import { ThinkingBlock } from './thinking-block'
import { renderEmojisInText, StickerImage } from './emoji-renderer'
import { formatDuration, type Turn } from '@/lib/turns'
import type { AssistantGroup, BubbleModel } from '@/lib/message-groups'
import type { MessageRating, MessageViewModel as MessageData } from '@/types'
import type { SenderNames } from '@/hooks/use-sender-names'
import type { EmojiMap } from './emoji-renderer'
import { TurnUsage } from './turn-usage'
import { ShellCommandCard } from './shell-command-card'

/**
 * Who is speaking: the assistant's own picture when it has one, otherwise the
 * logo of the model that wrote the row.
 *
 * `ModelIcon` matches on the model name and falls back to a generic mark of its
 * own, so a model nobody has a logo for still lands as something round rather
 * than a hole.
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
    <MessageGroupAvatar className="size-8">
      <Avatar className="size-full">
        {!hosted && <Avatar.Image src={src ?? undefined} />}
        {/* `ModelIcon` brings its own background, so `bg-default` underneath it
            would only show through the rounding. A bare glyph does not, and
            keeps the frame it is dropped into. */}
        <Avatar.Fallback className={hosted ? undefined : 'bg-transparent'}>
          {hosted ? <HostedAgentGlyph /> : <ModelIcon model={modelId ?? undefined} size={32} shape="circle" />}
        </Avatar.Fallback>
      </Avatar>
    </MessageGroupAvatar>
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

/** The time a bubble was sent, as the trailer of its text. Nothing for rows
 *  written before per-message timestamps, whose clock reads zero. */
function SentAt({ at }: { at: number }) {
  const clock = useClockTime()
  if (!(at > 0)) return null
  return <BubbleTime dateTime={new Date(at).toISOString()}>{clock.format(at)}</BubbleTime>
}

interface UserContentPart {
  type: string
  text?: string
  image_url?: { url: string }
  file?: { url: string; name: string; mime_type: string }
  sticker_id?: string
  name?: string
}

export interface UserMessageProps {
  message: MessageData
  onDelete?: (id: string) => void
  onEdit?: (id: string, content: string) => void
  isOneBot?: boolean
  emojiMap?: EmojiMap
  /** Nicknames for the ids on user rows. Only a group has more than one. */
  senderNames?: SenderNames
}

/** What the person said: a bubble against the right edge, with its
 *  attachments and stickers as their own items beside it. */
export const UserMessage = React.memo(function UserMessage({
  message,
  onDelete,
  onEdit,
  isOneBot,
  emojiMap,
  senderNames,
}: UserMessageProps) {
  const { t } = useTranslation()

  // User messages with attachments are stored as a JSON array of parts. Only
  // treat the content as multimodal when every element actually looks like a
  // part; arbitrary text such as "[null]" or "[1,2,3]" must stay plain text.
  const parsedUser = useMemo(() => {
    let contentParts: UserContentPart[] | null = null
    let textContent = message.content
    let copyText = message.content
    if (message.content.startsWith('[')) {
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
  }, [message.content])
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

  const { contentParts, copyText, textContent } = parsedUser
  const canEdit = !!onEdit && !contentParts
  const { senderPrefix, quotedMessage, body } = isOneBot
    ? parseOneBotContent(textContent)
    : { senderPrefix: null, quotedMessage: null, body: textContent }
  const speaker = isOneBot ? speakerLabel(message.sender_id, senderNames, senderPrefix) : null

  const hasAttachments = !!contentParts && contentParts.some((p) => p.type === 'image_url' || p.type === 'file')

  if (message.source === 'shell') {
    return (
      <>
        <MessageGroupUser>
          <ShellCommandCard message={message} />
          <MessageGroupFooter className="gap-1">
            <CopyButton text={copyText} />
            {onDelete && (
              <ActionButton label={t('chat.delete')} onClick={requestDelete} className="text-muted hover:text-danger">
                <TrashBin className="size-3.5" />
              </ActionButton>
            )}
          </MessageGroupFooter>
        </MessageGroupUser>
        {confirmDialog}
      </>
    )
  }

  const userContent = (
    <ContextMenu onOpenChange={handleContextMenuOpenChange}>
      <ContextMenuTrigger render={<MessageGroupUser className="pointer-coarse:select-none" />}>
        <>
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
                <Bubble align="end" variant="user">
                  <BubbleContent>
                    {speaker && (
                      <MessageGroupHeader className="text-[var(--bubble-user-foreground)]/80">
                        {speaker}
                      </MessageGroupHeader>
                    )}
                    {quotedMessage && (
                      <QuotedMessageBlock sender={quotedMessage.sender} content={quotedMessage.content} />
                    )}
                    {/* `flow-root` contains the floated time, so the bubble's
                        own padding wraps it instead of clipping it. */}
                    <div className="flow-root whitespace-pre-wrap">
                      {message.source === 'voice' && (
                        <Microphone
                          className="inline-block size-3.5 mr-1 -mt-0.5 opacity-60"
                          aria-label={t('chat.voice.badge')}
                        />
                      )}
                      {emojiMap && Object.keys(emojiMap).length > 0 ? renderEmojisInText(body, emojiMap) : body}
                      <span className="float-right ml-2 mt-1.5 opacity-70">
                        <SentAt at={message.created_at} />
                      </span>
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
              <MessageGroupFooter className="gap-1">
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
              </MessageGroupFooter>
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
})

/** The keyboard under a bubble: its reasoning first, then its calls, in the
 *  order the model made them. Every key is a disclosure whose panel lands in
 *  the keyboard's stack — see `bubble-keyboard.tsx`. */
function BubbleKeys({
  bubble,
  renderError,
}: {
  bubble: Extract<BubbleModel, { kind: 'text' | 'keyboard-only' }>
  renderError: React.ReactNode
}) {
  if (bubble.thinking.length === 0 && bubble.tools.length === 0) return null
  // Reasoning with nothing after it yet is the thought still being written,
  // and the only sign of life on screen until the answer starts.
  const thinkingLive = bubble.isStreaming && bubble.kind === 'keyboard-only' && bubble.tools.length === 0
  return (
    <ChatToolPresentationProvider value="keyboard">
      <BubbleKeyboard>
        {bubble.thinking.length > 0 && (
          <ThinkingBlock
            text={bubble.thinking.join('\n\n')}
            panelKey={`${bubble.key}:thinking`}
            isStreaming={thinkingLive}
          />
        )}
        {bubble.tools.map((tool, i) => (
          <ErrorBoundary key={`${tool.call_id}:${i}`} fallback={renderError}>
            <MemoToolCallBlock data={tool} queued={bubble.queued[i]} />
          </ErrorBoundary>
        ))}
      </BubbleKeyboard>
    </ChatToolPresentationProvider>
  )
}

function AssistantBubble({
  bubble,
  header,
  isOneBot,
  emojiMap,
  renderError,
}: {
  bubble: BubbleModel
  /** Who is speaking, on the first bubble of the run only. */
  header: string | null
  isOneBot?: boolean
  emojiMap?: EmojiMap
  renderError: React.ReactNode
}) {
  if (bubble.kind === 'sticker') {
    return (
      <div className="my-1 flex justify-start" data-slot="assistant-sticker">
        <StickerImage stickerId={bubble.stickerId} name={bubble.name ?? undefined} />
      </div>
    )
  }
  if (bubble.kind === 'keyboard-only') {
    return (
      <div
        data-slot="bubble"
        data-position={bubble.position}
        data-variant="keyboard-only"
        className="w-full max-w-[85%]"
      >
        <BubbleKeys bubble={bubble} renderError={renderError} />
      </div>
    )
  }
  const hasKeys = bubble.thinking.length > 0 || bubble.tools.length > 0
  return (
    // A bubble with a keyboard takes the column's width, so its keys have
    // room to sit two to a row; one without is as wide as what it says.
    <Bubble variant="assistant" position={bubble.position} className={cn(hasKeys && 'w-full')}>
      <BubbleContent className={cn(hasKeys && 'w-full')}>
        {header && <MessageGroupHeader>{header}</MessageGroupHeader>}
        <MarkdownContent
          content={bubble.text}
          isStreaming={bubble.isStreaming}
          oneBot={isOneBot}
          emojiMap={emojiMap}
          blockId={bubble.key}
          trailer={<SentAt at={bubble.createdAt} />}
        />
      </BubbleContent>
      <BubbleKeys bubble={bubble} renderError={renderError} />
    </Bubble>
  )
}

export interface AssistantGroupViewProps {
  group: AssistantGroup
  turn: Turn
  /** The row the turn's actions act on: rating, regeneration, deletion. */
  owner: MessageData | null
  /** Everything the run said, for the copy button and the context menu. */
  copyText: string
  /** The run that carries the turn's footer — the last one. */
  showFooter: boolean
  onDelete?: () => void
  onRegenerate?: () => void
  onRate?: (id: string, rating: MessageRating | null) => void
  isOneBot?: boolean
  /** A hosted Claude Code session: the assistant answering is not this app's. */
  isHosted?: boolean
  emojiMap?: EmojiMap
  assistantAvatar?: string | null
}

/**
 * One run of answers from one model: its avatar, its bubbles and, on the
 * last run of a turn, the turn's footer.
 */
export const AssistantGroupView = React.memo(function AssistantGroupView({
  group,
  turn,
  owner,
  copyText,
  showFooter,
  onDelete,
  onRegenerate,
  onRate,
  isOneBot,
  isHosted,
  emojiMap,
  assistantAvatar,
}: AssistantGroupViewProps) {
  const { t } = useTranslation()
  const [selectedText, setSelectedText] = useState('')
  const [showSelectText, setShowSelectText] = useState(false)
  const coarse = isCoarsePointer()
  const renderError = <div className="text-xs text-danger py-2">{t('chat.renderError')}</div>

  const { confirm, confirmDialog } = useConfirm()
  const requestDelete = useCallback(async () => {
    if (await confirm({ body: t('confirm.deleteMessage') })) onDelete?.()
  }, [confirm, t, onDelete])

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (open) setSelectedText(window.getSelection()?.toString()?.trim() ?? '')
  }, [])

  const isStreaming = turn.status === 'streaming'
  const rating = owner?.rating ?? null
  const rate = (value: MessageRating) => owner && onRate?.(owner.id, rating === value ? null : value)
  const canRate = !!onRate && !!owner && !isStreaming
  // A hosted session is named by its agent; the model id it reports is not a
  // name anyone would recognise. The name goes in the first bubble that has
  // prose to put it above — a run that opens on a bare keyboard has no line
  // to write it on until the answer starts.
  const header = isHosted ? null : group.modelId
  const headerIndex = group.bubbles.findIndex((b) => b.kind === 'text')

  return (
    // The footer is outside the row, below it, and the reason is the avatar:
    // it sits at the bottom of the row, so a footer inside the row — even an
    // invisible one, which it is until hovered — pushed the avatar down to sit
    // beside the footer rather than beside the last bubble.
    <div data-slot="assistant-group" className="group/message flex min-w-0 flex-col">
      <ContextMenu onOpenChange={handleContextMenuOpenChange}>
        <ContextMenuTrigger render={<MessageGroupAssistant className="pointer-coarse:select-none" />}>
          <AssistantAvatar src={assistantAvatar} modelId={group.modelId} hosted={isHosted} />
          <MessageGroupBubbles>
            {group.bubbles.map((bubble, i) => (
              <ErrorBoundary key={bubble.key} fallback={renderError}>
                <AssistantBubble
                  bubble={bubble}
                  header={i === headerIndex ? header : null}
                  isOneBot={isOneBot}
                  emojiMap={emojiMap}
                  renderError={renderError}
                />
              </ErrorBoundary>
            ))}
          </MessageGroupBubbles>
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
          {canRate && (
            <>
              <ContextMenuItem onClick={() => rate(1)}>
                <ThumbsUp className={rating === 1 ? 'text-success-soft-foreground' : ''} />
                {t('chat.thumbsUp')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => rate(-1)}>
                <ThumbsDown className={rating === -1 ? 'text-danger' : ''} />
                {t('chat.thumbsDown')}
              </ContextMenuItem>
            </>
          )}
          {onRegenerate && !isStreaming && (
            <ContextMenuItem onClick={onRegenerate}>
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
      {showFooter && (
        // Under the bubbles, indented past the avatar column. Cost and duration
        // only: the token counts are a ledger line, and they are one hover
        // away inside the usage card.
        <MessageGroupFooter className="pl-10">
          {/* Printed, not counted up to. The number is settled by the time the
              footer exists, and the footer only appears on hover — so the
              animation ran while the reader looked at a finished total, and
              made it read as still being worked out. */}
          <TurnUsage tokens={turn.tokens} usage={turn.usage} />
          {turn.durationMs != null && !isStreaming && (
            <span data-slot="turn-duration" className="font-normal tabular-nums">
              {t('chat.turn.duration', { duration: formatDuration(turn.durationMs) })}
            </span>
          )}
          <div className="flex gap-1">
            <CopyButton text={copyText} />
            {canRate && (
              <>
                <ActionButton
                  label={t('chat.thumbsUp')}
                  aria-pressed={rating === 1}
                  onClick={() => rate(1)}
                  className={cn(rating === 1 ? 'text-success-soft-foreground' : 'text-muted hover:text-foreground')}
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </ActionButton>
                <ActionButton
                  label={t('chat.thumbsDown')}
                  aria-pressed={rating === -1}
                  onClick={() => rate(-1)}
                  className={cn(rating === -1 ? 'text-danger' : 'text-muted hover:text-foreground')}
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </ActionButton>
              </>
            )}
            {onRegenerate && !isStreaming && (
              <ActionButton
                label={t('chat.regenerate')}
                onClick={onRegenerate}
                className="text-muted hover:text-foreground"
              >
                <ArrowsRotateRight className="w-3.5 h-3.5" />
              </ActionButton>
            )}
            {onDelete && (
              <ActionButton label={t('chat.delete')} onClick={requestDelete} className="text-muted hover:text-danger">
                <TrashBin className="w-3.5 h-3.5" />
              </ActionButton>
            )}
          </div>
        </MessageGroupFooter>
      )}
      {coarse && <SelectTextModal text={copyText} isOpen={showSelectText} onOpenChange={setShowSelectText} />}
      {confirmDialog}
    </div>
  )
})
