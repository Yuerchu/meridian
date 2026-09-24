import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bin,
  Check,
  Copy,
  CursorText,
  File,
  Mic,
  Pen,
  RefreshCw,
  Search,
  SquareTerminal,
  ThumbsDown,
  ThumbsUp,
  X,
} from '@keyline-icons/react/two-tone'
import { ModelIcon } from '@/components/ui/model-icon'
import { HostedAgentGlyph } from '@/components/ui/agent-icon'
import { cx } from '@/utils/cx'
import { ActionButton } from '@/components/ui/action-button'
import { useConfirm } from '@/hooks/use-confirm'
import { ConversationRefChips } from './conversation-ref-chips'
import { CopyButton, MarkdownContent } from './markdown-content'
import { Avatar, Label, TextArea } from '@/components/base'
import { AgentThinking } from '@/components/application/agent-thinking/agent-thinking'
import { ContextMenu } from '@/components/base'
import {
  MessageGroupAssistant,
  MessageGroupAvatar,
  MessageGroupBubbles,
  MessageGroupFooter,
  MessageGroupHeader,
  MessageGroupUser,
} from '@/components/ui/message-group'
import { Bubble, BubbleContent, BubbleTime, BUBBLE_RUN_GAP } from '@/components/ui/bubble'
import { BubbleFoldBadge } from '@/components/ui/bubble-block'
import { ChatToolPresentationProvider } from '@/components/ui/chat-tool'
import { useConversationStore } from '@/stores/conversation-store'
import { useTranscriptConversationId } from '@/hooks/use-transcript-conversation'
import { ChatAttachment, ChatAttachmentGroup } from '@/components/base'
import { ErrorBoundary } from '@/components/error-boundary'

import { assetSrc } from '@/lib/asset-src'
import { isCoarsePointer, isSubmitKey } from '@/hooks/use-coarse-pointer'
import { useClockTime } from '@/hooks/use-clock-time'
import { SelectTextModal } from './select-text-modal'
import { ToolCallBlock } from './tool-call-block'
import { ThinkingRow } from './thinking-block'
import { SubAgentGroup, delegationOf } from './sub-agent-group'
import { renderEmojisInText, StickerImage } from './emoji-renderer'
import type { Turn } from '@/lib/turns'
import { bubbleCopyText } from '@/lib/message-groups'
import type { AssistantGroup, BubbleModel, BubblePosition, FoldKind, FoldedCalls } from '@/lib/message-groups'
import type { MessageRating, MessageViewModel as MessageData } from '@/types'
import type { SenderNames } from '@/hooks/use-sender-names'
import type { EmojiMap } from './emoji-renderer'
import { TurnInfo } from './turn-info'
import { ShellCommandBubble } from './shell-command-bubble'

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
      {/* The glyph is always given: it is what `Avatar` shows when the photo
          fails to load, so a stale URL costs a model icon rather than a
          broken image on every message. */}
      <Avatar src={!hosted && src ? src : undefined} className="size-full">
        {hosted ? <HostedAgentGlyph /> : <ModelIcon model={modelId ?? undefined} size={32} shape="circle" />}
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
    <div
      data-slot="quoted-message"
      // Washes of the bubble's own ink over its fill, not a fixed colour: the
      // person's bubble was black once and is the white card now, and
      // `text-white/70` is invisible on the second.
      className="mb-2 border-l-2 border-[color-mix(in_oklch,var(--bubble-fill),var(--bubble-ink)_30%)] pl-3 text-caption-1-regular text-[color-mix(in_oklch,var(--bubble-fill),var(--bubble-ink)_70%)]"
    >
      <span data-slot="quoted-message-sender" className="text-caption-1-medium">
        {sender}
      </span>
      <p data-slot="quoted-message-content" className="mt-0.5 line-clamp-3 whitespace-pre-wrap">
        {content}
      </p>
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
  /** Where this sits in a run of unanswered questions — the corners. */
  position?: BubblePosition
}

/**
 * What the person said: a bubble against the right edge, laid out the way
 * the model's are. Its head is what the message carried — the speaker in a
 * group, the message it quoted, the conversations it referenced, its
 * attachments — above what it said, and the time sits at the end of the last
 * line or, with nothing said, on a foot line of its own. Stickers stay
 * outside the bubble, as the model's do. `position` is the run treatment
 * `questionPositionOf` decided; the bubble reads nothing off its siblings.
 */
export const UserMessage = React.memo(function UserMessage({
  message,
  onDelete,
  onEdit,
  isOneBot,
  emojiMap,
  senderNames,
  position = 'single',
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
  const hasRefs = message.context_items.some((item) => item.kind === 'conversation')
  const hasBody = !!body || message.source === 'voice'
  const hasBubble = hasBody || !!quotedMessage || hasRefs || hasAttachments

  if (message.source === 'shell') {
    return (
      <>
        <MessageGroupUser>
          <ShellCommandBubble message={message} position={position} />
          <MessageGroupFooter className="gap-1">
            <CopyButton text={copyText} />
            {onDelete && (
              <ActionButton
                label={t('chat.delete')}
                onClick={requestDelete}
                className="data-[hovered]:text-status-danger"
                icon={Bin}
              />
            )}
          </MessageGroupFooter>
        </MessageGroupUser>
        {confirmDialog}
      </>
    )
  }

  const userContent = (
    <ContextMenu onOpenChange={handleContextMenuOpenChange}>
      {/* The group *is* the trigger: `render` passes DOM props through to the
          group, whose own `flex` display is preserved. */}
      <ContextMenu.Trigger className="pointer-coarse:select-none" render={(props) => <MessageGroupUser {...props} />}>
        <>
          {editing ? (
            // Full width while editing. A bubble is sized to what it says, but
            // an edit box is sized to what you are about to say — and the
            // 80% cap turned a message being rewritten into a narrow column
            // with the text reflowing under the caret.
            <Bubble align="end" variant="outline" className="w-full max-w-full">
              <BubbleContent>
                <TextArea
                  ref={editRef}
                  aria-label={t('chat.editMessage')}
                  value={editText}
                  onChange={(e) => {
                    setEditText(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = e.target.scrollHeight + 'px'
                  }}
                  onKeyDown={handleEditKeyDown}
                  className="w-full min-w-[200px] min-h-0 rounded-none border-0 p-0 field-sizing-fixed bg-transparent dark:bg-transparent text-body-regular leading-relaxed resize-none outline-none focus-visible:ring-0"
                  rows={1}
                />
                <div data-slot="message-edit-actions" className="flex justify-end gap-1 mt-1.5">
                  <ActionButton label={t('chat.cancelEdit')} onClick={handleCancelEdit} icon={X} />
                  <ActionButton label={t('chat.saveEdit')} onClick={handleSaveEdit} icon={Check} />
                </div>
              </BubbleContent>
            </Bubble>
          ) : (
            <>
              {hasBubble && (
                <Bubble align="end" variant="user" position={position}>
                  <BubbleContent>
                    {speaker && (
                      <MessageGroupHeader className="text-[var(--bubble-user-foreground)]/80">
                        {speaker}
                      </MessageGroupHeader>
                    )}
                    {quotedMessage && (
                      <QuotedMessageBlock sender={quotedMessage.sender} content={quotedMessage.content} />
                    )}
                    {hasRefs && <ConversationRefChips items={message.context_items} className="mb-1.5" />}
                    {hasAttachments && (
                      <ChatAttachmentGroup className="mb-1.5">
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
                            <ChatAttachment key={`file-${i}`} name={p.file?.name || t('chat.attachedFile')} />
                          ))}
                      </ChatAttachmentGroup>
                    )}
                    {hasBody ? (
                      // `flow-root` contains the floated time, so the bubble's
                      // own padding wraps it instead of clipping it.
                      <div data-slot="user-message-body" className="flow-root whitespace-pre-wrap">
                        {message.source === 'voice' && (
                          <Mic
                            className="inline-block size-3.5 mr-1 -mt-0.5 opacity-60"
                            aria-label={t('chat.voice.badge')}
                          />
                        )}
                        {emojiMap && Object.keys(emojiMap).length > 0 ? renderEmojisInText(body, emojiMap) : body}
                        <span data-slot="user-message-time" className="float-right ml-2 mt-1.5 opacity-70">
                          <SentAt at={message.created_at} />
                        </span>
                      </div>
                    ) : (
                      // Nothing said, only carried: the time takes a foot line
                      // of its own, where a bubble with badges puts it.
                      <div data-slot="user-message-foot" className="flex justify-end opacity-70">
                        <SentAt at={message.created_at} />
                      </div>
                    )}
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
                  <ActionButton ref={editButtonRef} label={t('chat.edit')} onClick={handleStartEdit} icon={Pen} />
                )}
                <CopyButton text={copyText} />
                {onDelete && (
                  <ActionButton
                    label={t('chat.delete')}
                    onClick={requestDelete}
                    className="data-[hovered]:text-status-danger"
                    icon={Bin}
                  />
                )}
              </MessageGroupFooter>
            </>
          )}
        </>
      </ContextMenu.Trigger>
      <ContextMenu.Popover>
        <ContextMenu.Menu aria-label={t('contextMenu.messageActions')}>
          {selectedText && (
            <>
              <ContextMenu.Item
                id="copy-selection"
                textValue={t('contextMenu.copySelection')}
                onAction={() => void navigator.clipboard.writeText(selectedText)}
              >
                <Copy className="size-4 text-text-secondary" />
                <Label>{t('contextMenu.copySelection')}</Label>
              </ContextMenu.Item>
              <ContextMenu.Separator />
            </>
          )}
          {canEdit && (
            <ContextMenu.Item id="edit" textValue={t('chat.edit')} onAction={handleStartEdit}>
              <Pen className="size-4 text-text-secondary" />
              <Label>{t('chat.edit')}</Label>
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            id="copy"
            textValue={t('chat.copy')}
            onAction={() => void navigator.clipboard.writeText(copyText)}
          >
            <Copy className="size-4 text-text-secondary" />
            <Label>{t('chat.copy')}</Label>
          </ContextMenu.Item>
          {coarse && (
            <ContextMenu.Item
              id="select-text"
              textValue={t('contextMenu.selectText')}
              onAction={() => setShowSelectText(true)}
            >
              <CursorText className="size-4 text-text-secondary" />
              <Label>{t('contextMenu.selectText')}</Label>
            </ContextMenu.Item>
          )}
          {onDelete && (
            <>
              <ContextMenu.Separator />
              {/* Deleting the question takes its whole subtree — every answer
                  and every later exchange hangs off it — so the menu says so
                  beside "copy", which only ever means this bubble. */}
              <ContextMenu.Item
                id="delete"
                textValue={t('chat.turnAction.delete')}
                variant="danger"
                onAction={() => void requestDelete()}
              >
                <Bin className="size-4" />
                <Label>{t('chat.turnAction.delete')}</Label>
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Menu>
      </ContextMenu.Popover>
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

const FOLD_ICONS: Record<FoldKind, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  commands: SquareTerminal,
  files: File,
  searches: Search,
}

/**
 * Which badges the reader has opened. In the store, beside the panel choices,
 * for the same reason those are: the transcript is reloaded when a turn ends,
 * which remounts every bubble, and a badge that snapped shut at that moment
 * would be one the reader has to open twice. Outside a conversation — the
 * playground — the choice is kept here.
 *
 * One string rather than one subscription per badge, so a bubble with three
 * badges re-renders once when any of them changes and never when none has.
 */
function useFoldExpansion(folded: FoldedCalls[]) {
  // The transcript's conversation, not the window's: the same rule
  // `usePanelExpansion` follows, and for the same reason.
  const conversationId = useTranscriptConversationId()
  const stored = useConversationStore((s) => {
    if (!conversationId) return ''
    const panels = s.sessions[conversationId]?.expandedPanels
    return folded.map((f) => (panels?.[f.key] ? '1' : '0')).join('')
  })
  const setPanelExpanded = useConversationStore((s) => s.setPanelExpanded)
  const [local, setLocal] = useState<Record<string, boolean>>({})
  const isOpen = useCallback(
    (key: string) => {
      if (!conversationId) return local[key] ?? false
      const i = folded.findIndex((f) => f.key === key)
      return stored[i] === '1'
    },
    [conversationId, folded, local, stored],
  )
  const toggle = useCallback(
    (key: string) => {
      const next = !isOpen(key)
      if (conversationId) setPanelExpanded(conversationId, key, next)
      else setLocal((current) => ({ ...current, [key]: next }))
    },
    [conversationId, isOpen, setPanelExpanded],
  )
  return { isOpen, toggle }
}

/** The badges standing in for a bubble's folded calls, in a row.
 *
 *  `aria-expanded` and no `aria-controls`: what a badge opens is several
 *  blocks rather than one panel, and they are the bubble's own children now.
 *  Naming one of them would be naming an arbitrary one; wrapping them so there
 *  is something to name would cost them their fill and their corners, which
 *  `bubble.tsx` gives to direct children only. */
function FoldBadges({
  folded,
  isOpen,
  toggle,
}: {
  folded: FoldedCalls[]
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div data-slot="bubble-fold-badges" className="flex min-w-0 flex-wrap items-center gap-1">
      {folded.map((fold) => {
        const Icon = FOLD_ICONS[fold.kind]
        return (
          <BubbleFoldBadge key={fold.key} expanded={isOpen(fold.key)} onClick={() => toggle(fold.key)}>
            <Icon aria-hidden className="size-3" />
            {t(`chat.tool.fold.${fold.kind}`, { count: fold.count })}
          </BubbleFoldBadge>
        )
      })}
    </div>
  )
}

/**
 * The keys a badge opens into: a keyboard of their own, boxed like a panel,
 * under the bubble and above its ordinary keyboard.
 *
 * Nothing of a folded call exists in the DOM until its badge is opened. That
 * is the point of folding rather than merely hiding: a closed disclosure
 * panel still holds its highlighted file, and sixty of them is what made a
 * long research turn stop scrolling.
 */
function FoldPanels({
  folded,
  isOpen,
  renderError,
}: {
  folded: FoldedCalls[]
  isOpen: (key: string) => boolean
  renderError: React.ReactNode
}) {
  const open = folded.filter((fold) => isOpen(fold.key))
  if (open.length === 0) return null
  // No box around them, and none between them and the bubble: what a badge
  // opens is the blocks themselves, and a block is a block wherever it came
  // from. A wrapper would also break the rule `bubble.tsx` styles them with —
  // it reads the bubble's *direct* children, so a block one level down would
  // lose its fill and its corners.
  return (
    <ChatToolPresentationProvider value="bubble">
      {open.map((fold) =>
        fold.tools.map((tool, i) => (
          <ErrorBoundary key={`${fold.key}:${tool.call_id}:${i}`} fallback={renderError}>
            <MemoToolCallBlock data={tool} queued={false} />
          </ErrorBoundary>
        )),
      )}
    </ChatToolPresentationProvider>
  )
}

/** The last line of a bubble that folded something: its badges on the left,
 *  the time on the right — the shape a messenger gives a message's footer. */
function FoldRow({
  folded,
  isOpen,
  toggle,
  at,
  isStreaming,
}: {
  folded: FoldedCalls[]
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
  at: number
  isStreaming: boolean
}) {
  return (
    <div data-slot="bubble-fold-row" className="mt-1.5 flex min-w-0 items-center justify-between gap-3">
      <FoldBadges folded={folded} isOpen={isOpen} toggle={toggle} />
      {!isStreaming && <SentAt at={at} />}
    </div>
  )
}

/** The calls a bubble made, in the order the model made them: one block each,
 *  siblings of the prose in the same bubble — see `bubble.tsx`. The reasoning
 *  is not one of them; it is `ThinkingRow`, at the head of the prose block. */
function BubbleKeys({
  bubble,
  renderError,
}: {
  bubble: Extract<BubbleModel, { kind: 'text' | 'tools-only' }>
  renderError: React.ReactNode
}) {
  if (bubble.tools.length === 0) return null
  // The delegations a round made together are one group, drawn first: the
  // runs are what the round is waiting on, and three keys side by side said
  // nothing about which of them still was. A call whose arguments are still
  // streaming is not a delegation yet and stays a key.
  const runs = bubble.tools.filter((tool) => delegationOf(tool) !== null)
  const keys = bubble.tools.map((tool, i) => [tool, i] as const).filter(([tool]) => delegationOf(tool) === null)
  return (
    <ChatToolPresentationProvider value="bubble">
      {runs.length > 0 && (
        <ErrorBoundary fallback={renderError}>
          <SubAgentGroup calls={runs} />
        </ErrorBoundary>
      )}
      {keys.map(([tool, i]) => (
        <ErrorBoundary key={`${tool.call_id}:${i}`} fallback={renderError}>
          <MemoToolCallBlock data={tool} queued={bubble.queued[i]} />
        </ErrorBoundary>
      ))}
    </ChatToolPresentationProvider>
  )
}

const NO_FOLDS: FoldedCalls[] = []

function AssistantBubble({
  bubble,
  header,
  workingLabel,
  isOneBot,
  emojiMap,
  renderError,
}: {
  bubble: BubbleModel
  /** Who is speaking, on the first bubble of the run only. */
  header: string | null
  /** What the `working` bubble says beside its spinner. */
  workingLabel: string | null
  isOneBot?: boolean
  emojiMap?: EmojiMap
  renderError: React.ReactNode
}) {
  const { t } = useTranslation()
  const folded = 'folded' in bubble ? bubble.folded : NO_FOLDS
  const { isOpen, toggle } = useFoldExpansion(folded)

  if (bubble.kind === 'sticker') {
    return (
      <div className="my-1 flex justify-start" data-slot="assistant-sticker" data-bubble-key={bubble.key}>
        <StickerImage stickerId={bubble.stickerId} name={bubble.name ?? undefined} />
      </div>
    )
  }
  if (bubble.kind === 'working') {
    return (
      // The typing indicator: the next bubble of the run, with boardui's
      // `agent-thinking` where the words will be. That component is the
      // `role="status"` (so it is announced once, not twice), and
      // `data-working` is how the tests find the sign of life without
      // knowing its wording.
      <Bubble variant="assistant" position={bubble.position} data-working="true" data-bubble-key={bubble.key}>
        <BubbleContent>
          <AgentThinking variant="infinity" label={workingLabel ?? t('chat.turn.working.thinking')} />
        </BubbleContent>
      </Bubble>
    )
  }
  const panels = <FoldPanels folded={folded} isOpen={isOpen} renderError={renderError} />
  if (bubble.kind === 'summary') {
    return (
      <Bubble variant="assistant" position={bubble.position} data-bubble-key={bubble.key} className="w-full">
        <BubbleContent className="w-full">
          <FoldRow folded={folded} isOpen={isOpen} toggle={toggle} at={bubble.createdAt} isStreaming={false} />
        </BubbleContent>
        {panels}
      </Bubble>
    )
  }
  if (bubble.kind === 'tools-only') {
    const keys = <BubbleKeys bubble={bubble} renderError={renderError} />
    const hasThinking = bubble.thinking.length > 0
    const hasFolds = folded.length > 0
    if (hasThinking || hasFolds) {
      // A row with no prose but something to say about itself — the thought
      // it started from, the reads it folded — gets a bubble to say it in,
      // laid out as a prose bubble is: reasoning at the head, badges and the
      // time at the foot, keys under the bubble. Badges outside any bubble
      // used to float between two of them, which read as belonging to
      // neither. While nothing has followed the thought yet it is still
      // being written, and the only sign of life until the answer starts.
      const live = bubble.isStreaming && bubble.tools.length === 0 && !hasFolds
      return (
        <Bubble variant="assistant" position={bubble.position} data-bubble-key={bubble.key} className="w-full">
          <BubbleContent className="w-full">
            {hasThinking && (
              <ThinkingRow text={bubble.thinking.join('\n\n')} panelKey={`${bubble.key}:thinking`} isStreaming={live} />
            )}
            {hasFolds && (
              <FoldRow
                folded={folded}
                isOpen={isOpen}
                toggle={toggle}
                at={bubble.createdAt}
                isStreaming={bubble.isStreaming}
              />
            )}
          </BubbleContent>
          {panels}
          {keys}
        </Bubble>
      )
    }
    return (
      <div
        data-slot="bubble"
        data-position={bubble.position}
        data-variant="tools-only"
        data-bubble-key={bubble.key}
        className={cx('flex w-full max-w-[85%] flex-col', BUBBLE_RUN_GAP)}
      >
        {panels}
        {keys}
      </div>
    )
  }
  const hasKeys = bubble.thinking.length > 0 || bubble.tools.length > 0
  const hasFolds = folded.length > 0
  return (
    // A bubble with a keyboard takes the column's width, so its keys have
    // room to sit two to a row; one with badges takes it so the time sits at
    // the far edge of the row; one with neither is as wide as what it says.
    <Bubble
      variant="assistant"
      position={bubble.position}
      data-bubble-key={bubble.key}
      className={cx((hasKeys || hasFolds) && 'w-full')}
    >
      <BubbleContent className={cx((hasKeys || hasFolds) && 'w-full')}>
        {header && <MessageGroupHeader>{header}</MessageGroupHeader>}
        {bubble.thinking.length > 0 && (
          // Finished by definition: there is prose under it.
          <ThinkingRow text={bubble.thinking.join('\n\n')} panelKey={`${bubble.key}:thinking`} />
        )}
        <MarkdownContent
          content={bubble.text}
          isStreaming={bubble.isStreaming}
          oneBot={isOneBot}
          emojiMap={emojiMap}
          blockId={bubble.key}
          // With badges the time moves out of the last paragraph and on to
          // their row, where it is the right-hand end of the footer.
          trailer={hasFolds ? null : <SentAt at={bubble.createdAt} />}
        />
        {hasFolds && (
          <FoldRow
            folded={folded}
            isOpen={isOpen}
            toggle={toggle}
            at={bubble.createdAt}
            isStreaming={bubble.isStreaming}
          />
        )}
      </BubbleContent>
      {panels}
      <BubbleKeys bubble={bubble} renderError={renderError} />
    </Bubble>
  )
}

export interface AssistantGroupViewProps {
  group: AssistantGroup
  turn: Turn
  /** The row the turn's actions act on: rating, regeneration, deletion. */
  owner: MessageData | null
  /** What the turn's footer copies: its conclusion — see `turnCopyText`. The
   *  right-click menu does not use it; that copies the bubble it was opened on. */
  turnCopyText: string
  /** The run that carries the turn's footer — the last one. */
  showFooter: boolean
  /** What the `working` bubble says, when the run ends on one. */
  workingLabel?: string | null
  onDelete?: () => void
  onRegenerate?: () => void
  onRate?: (id: string, rating: MessageRating | null) => void
  isOneBot?: boolean
  /** A hosted Claude Code session: the assistant answering is not this app's. */
  isHosted?: boolean
  emojiMap?: EmojiMap
  assistantAvatar?: string | null
}

/** The bubble a right-click landed in, read back off the event the way the
 *  sidebar reads its row: one menu for the whole run, aimed by `data-bubble-key`.
 *  A key that is not one of this run's bubbles — a transcript inside a sheet
 *  portalled from here, whose events bubble through React — aims at nothing. */
function bubbleAt(target: EventTarget | null, bubbles: readonly BubbleModel[]): BubbleModel | null {
  if (!(target instanceof Element)) return null
  const key = target.closest('[data-bubble-key]')?.getAttribute('data-bubble-key')
  if (!key) return null
  return bubbles.find((b) => b.key === key) ?? null
}

/**
 * One run of answers from one model: its avatar, its bubbles and, on the
 * last run of a turn, the turn's footer.
 *
 * **Every action says what it acts on, and the menu never mixes the two
 * without saying so.** Copy and "select text" act on the bubble the menu was
 * opened on. Rating, regeneration and deletion cannot: a rating is stored on
 * the row carrying the turn's conclusion, regeneration replaces the turn's
 * first answer, and deletion takes the whole subtree from the question down
 * (messages are a tree, and a lone row cannot be dropped without stranding its
 * tool results). So in the menu those three are labelled as the turn's, under
 * a separator; in the footer, which only appears at the end of a turn, they
 * keep their short names.
 */
export const AssistantGroupView = React.memo(function AssistantGroupView({
  group,
  turn,
  owner,
  turnCopyText,
  showFooter,
  workingLabel = null,
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
  // What the open menu is aimed at: the prose of the bubble it was opened on,
  // or null when that bubble has none (a keyboard, a summary, the avatar).
  const [targetText, setTargetText] = useState<string | null>(null)
  const [showSelectText, setShowSelectText] = useState(false)
  const coarse = isCoarsePointer()
  const renderError = (
    <div data-slot="render-error" className="text-caption-1-regular text-status-danger py-2">
      {t('chat.renderError')}
    </div>
  )

  const { confirm, confirmDialog } = useConfirm()
  const requestDelete = useCallback(async () => {
    if (await confirm({ body: t('confirm.deleteMessage') })) onDelete?.()
  }, [confirm, t, onDelete])

  const isStreaming = turn.status === 'streaming'
  const rating = owner?.rating ?? null
  const rate = (value: MessageRating) => owner && onRate?.(owner.id, rating === value ? null : value)
  const canRate = !!onRate && !!owner && !isStreaming
  const canRegenerate = !!onRegenerate && !isStreaming
  const hasTurnActions = canRate || canRegenerate || !!onDelete

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const selection = window.getSelection()?.toString()?.trim() ?? ''
      const bubble = bubbleAt(event.target, group.bubbles)
      const text = bubble ? bubbleCopyText(bubble) : null
      // Nothing to offer: leave the menu shut rather than open an empty one.
      if (!selection && text === null && !hasTurnActions) {
        event.preventDefault()
        return
      }
      setSelectedText(selection)
      setTargetText(text)
    },
    [group.bubbles, hasTurnActions],
  )
  const hasBubbleActions = !!selectedText || targetText !== null
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
      <ContextMenu>
        {/* Same shape as the user group above: the group is the trigger, and
            the bubble under the pointer is what the menu is aimed at. */}
        <ContextMenu.Trigger
          className="pointer-coarse:select-none"
          onContextMenu={handleContextMenu}
          render={(props) => <MessageGroupAssistant {...props} />}
        >
          <AssistantAvatar src={assistantAvatar} modelId={group.modelId} hosted={isHosted} />
          <MessageGroupBubbles>
            {group.bubbles.map((bubble, i) => (
              <ErrorBoundary key={bubble.key} fallback={renderError}>
                <AssistantBubble
                  bubble={bubble}
                  header={i === headerIndex ? header : null}
                  workingLabel={workingLabel}
                  isOneBot={isOneBot}
                  emojiMap={emojiMap}
                  renderError={renderError}
                />
              </ErrorBoundary>
            ))}
          </MessageGroupBubbles>
        </ContextMenu.Trigger>
        <ContextMenu.Popover>
          <ContextMenu.Menu aria-label={t('contextMenu.messageActions')}>
            {selectedText && (
              <ContextMenu.Item
                id="copy-selection"
                textValue={t('contextMenu.copySelection')}
                onAction={() => void navigator.clipboard.writeText(selectedText)}
              >
                <Copy className="size-4 text-text-secondary" />
                <Label>{t('contextMenu.copySelection')}</Label>
              </ContextMenu.Item>
            )}
            {targetText !== null && (
              <ContextMenu.Item
                id="copy"
                textValue={t('chat.copy')}
                onAction={() => void navigator.clipboard.writeText(targetText)}
              >
                <Copy className="size-4 text-text-secondary" />
                <Label>{t('chat.copy')}</Label>
              </ContextMenu.Item>
            )}
            {coarse && targetText !== null && (
              <ContextMenu.Item
                id="select-text"
                textValue={t('contextMenu.selectText')}
                onAction={() => setShowSelectText(true)}
              >
                <CursorText className="size-4 text-text-secondary" />
                <Label>{t('contextMenu.selectText')}</Label>
              </ContextMenu.Item>
            )}
            {hasBubbleActions && hasTurnActions && <ContextMenu.Separator />}
            {canRate && (
              <>
                <ContextMenu.Item id="thumbs-up" textValue={t('chat.turnAction.thumbsUp')} onAction={() => rate(1)}>
                  <ThumbsUp
                    className={cx(
                      'size-4',
                      rating === 1 ? 'text-status-success-soft-foreground' : 'text-text-secondary',
                    )}
                  />
                  <Label>{t('chat.turnAction.thumbsUp')}</Label>
                </ContextMenu.Item>
                <ContextMenu.Item
                  id="thumbs-down"
                  textValue={t('chat.turnAction.thumbsDown')}
                  onAction={() => rate(-1)}
                >
                  <ThumbsDown className={cx('size-4', rating === -1 ? 'text-status-danger' : 'text-text-secondary')} />
                  <Label>{t('chat.turnAction.thumbsDown')}</Label>
                </ContextMenu.Item>
              </>
            )}
            {canRegenerate && (
              <ContextMenu.Item id="regenerate" textValue={t('chat.turnAction.regenerate')} onAction={onRegenerate}>
                <RefreshCw className="size-4 text-text-secondary" />
                <Label>{t('chat.turnAction.regenerate')}</Label>
              </ContextMenu.Item>
            )}
            {onDelete && (
              <>
                {(canRate || canRegenerate) && <ContextMenu.Separator />}
                <ContextMenu.Item
                  id="delete"
                  textValue={t('chat.turnAction.delete')}
                  variant="danger"
                  onAction={() => void requestDelete()}
                >
                  <Bin className="size-4" />
                  <Label>{t('chat.turnAction.delete')}</Label>
                </ContextMenu.Item>
              </>
            )}
          </ContextMenu.Menu>
        </ContextMenu.Popover>
      </ContextMenu>
      {showFooter && (
        // Under the bubbles, indented past the avatar column: the actions
        // alone. Duration, tokens and cost are one press away behind the info
        // action, which is where a new metric goes too.
        <MessageGroupFooter className="pl-10 has-[[aria-expanded=true]]:opacity-100">
          <div data-slot="assistant-actions" className="flex gap-1">
            <CopyButton text={turnCopyText} />
            {canRate && (
              <>
                <ActionButton
                  label={t('chat.thumbsUp')}
                  aria-pressed={rating === 1}
                  onClick={() => rate(1)}
                  className={cx(rating === 1 && 'text-status-success-soft-foreground')}
                  icon={ThumbsUp}
                />
                <ActionButton
                  label={t('chat.thumbsDown')}
                  aria-pressed={rating === -1}
                  onClick={() => rate(-1)}
                  className={cx(rating === -1 && 'text-status-danger-soft-foreground')}
                  icon={ThumbsDown}
                />
              </>
            )}
            {canRegenerate && <ActionButton label={t('chat.regenerate')} onClick={onRegenerate} icon={RefreshCw} />}
            <TurnInfo tokens={turn.tokens} usage={turn.usage} durationMs={turn.durationMs} isStreaming={isStreaming} />
            {onDelete && (
              <ActionButton
                label={t('chat.delete')}
                onClick={requestDelete}
                className="data-[hovered]:text-status-danger"
                icon={Bin}
              />
            )}
          </div>
        </MessageGroupFooter>
      )}
      {coarse && targetText !== null && (
        <SelectTextModal text={targetText} isOpen={showSelectText} onOpenChange={setShowSelectText} />
      )}
      {confirmDialog}
    </div>
  )
})
