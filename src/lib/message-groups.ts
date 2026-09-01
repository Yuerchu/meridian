import { blocksOf, markQueued, type Turn } from '@/lib/turns'
import type { ContentBlock, ToolCallDisplay } from '@/types'

/**
 * What a turn's answer looks like, as a flat list of bubbles.
 *
 * A projection, not a container. The transcript is drawn the way an instant
 * messenger draws a conversation — consecutive messages from one speaker stack
 * into a group with one avatar — and the shape of each bubble (which corners
 * are rounded, whether it carries the group's header, whether it is the one the
 * stream is writing into) is decided here as data and read back off
 * `data-position` by CSS. The components below this stay stateless; the DOM
 * stays flat.
 *
 * Grouping used to be a container component reading `isFirstInGroup` off its
 * neighbours. That kept the rule in three places — the row deciding to draw an
 * avatar, the row deciding to draw a header, and the turn deciding which rows
 * were adjacent — and they disagreed exactly where a hosted session's rows
 * changed model mid-turn.
 */

export type BubblePosition = 'single' | 'first' | 'middle' | 'last'

export type BubbleModel =
  | {
      kind: 'text'
      key: string
      messageId: string
      /** One Markdown segment. A OneBot reply splits on `\n---\n` into several
       *  bubbles, which is why this is a segment rather than the whole block. */
      text: string
      thinking: string[]
      tools: ToolCallDisplay[]
      /** `markQueued` over the whole turn, sliced to this bubble's calls. */
      queued: boolean[]
      createdAt: number
      position: BubblePosition
      /** The one bubble the live stream is writing into. */
      isStreaming: boolean
    }
  | {
      /** Reasoning or tool calls that no prose introduced: a row that opened
       *  straight on a call. Drawn as a keyboard with no bubble behind it. */
      kind: 'keyboard-only'
      key: string
      messageId: string
      thinking: string[]
      tools: ToolCallDisplay[]
      queued: boolean[]
      createdAt: number
      position: BubblePosition
      isStreaming: boolean
    }
  | {
      /** A sticker is outside the bubble, the way a messenger draws one — it is
       *  its own picture, not text to wrap a rectangle around. It joins the
       *  group but takes no corner treatment. */
      kind: 'sticker'
      key: string
      messageId: string
      stickerId: string
      name: string | null
      createdAt: number
      position: BubblePosition
      isStreaming: false
    }

export interface AssistantGroup {
  /** The first row's id: stable for keys, and what the group's avatar names. */
  id: string
  modelId: string | null
  bubbles: BubbleModel[]
  /** The rows this group was built from, in order. */
  messageIds: string[]
}

export interface BuildGroupsOptions {
  /** Split text bubbles on `\n---\n`. Only a OneBot reply means that: in an
   *  ordinary chat a Markdown rule is part of one message. */
  oneBot?: boolean
}

/** Chat text is paragraphs; a run of text blocks reads as one bubble until a
 *  call or a reasoning block interrupts it. */
type OpenBubble = Extract<BubbleModel, { kind: 'text' | 'keyboard-only' }>

/**
 * Consecutive assistant rows under one question, grouped by the model that
 * wrote them and cut into bubbles.
 *
 * The cut follows the engine's own rhythm. One assistant row is one model
 * response: the prose it opened with, then the calls it made. So a bubble is a
 * run of text with the calls that followed it hanging off its keyboard, and a
 * new run of text after those calls is the next bubble. Reasoning that comes
 * *before* the prose in a row attaches to that prose too — it is the thinking
 * behind that bubble, and a keyboard is where it is looked up — while a row
 * that never gets to prose leaves a keyboard with nothing above it.
 */
export function buildAssistantGroups(turn: Turn, options: BuildGroupsOptions = {}): AssistantGroup[] {
  const messages = turn.assistantMessages
  if (messages.length === 0) return []

  // Queued-ness is a fact about the whole turn's sequence of calls, not about
  // one bubble's, so it is computed once here and dealt out below.
  const statuses: ToolCallDisplay['status'][] = []
  for (const m of messages) {
    for (const b of blocksOf(m)) if (b.type === 'tool_call') statuses.push(b.data.status)
  }
  const queuedFlags = markQueued(statuses)
  let cursor = 0
  const nextQueued = () => queuedFlags[cursor++] ?? false

  const groups: AssistantGroup[] = []
  let group: AssistantGroup | null = null
  let open: OpenBubble | null = null

  const close = () => {
    open = null
  }

  for (const m of messages) {
    if (!group || group.modelId !== m.model_id) {
      close()
      group = { id: m.id, modelId: m.model_id, bubbles: [], messageIds: [] }
      groups.push(group)
    }
    const g: AssistantGroup = group
    g.messageIds.push(m.id)
    // A row that only searched has nothing to say in words: the search summary
    // is the answer, and the reasoning behind it would be a second answer.
    const blocks = hideThinkingForSearchOnly(blocksOf(m))
    let segment = 0
    const keyFor = () => `${m.id}:${segment++}`

    // A new row is a new response; whatever bubble the last row left open is
    // done, and reasoning does not carry across the boundary.
    close()
    let pendingThinking: string[] = []

    for (const block of blocks) {
      if (block.type === 'thinking') {
        // After prose, or between two calls of one response: it belongs to the
        // bubble it sits in. Before anything: it waits for the prose to come.
        if (open) open.thinking.push(block.text)
        else pendingThinking.push(block.text)
        continue
      }
      if (block.type === 'text') {
        if (!block.text.trim()) continue
        const segments = options.oneBot ? splitOneBot(block.text) : [block.text]
        for (const text of segments) {
          if (open && open.kind === 'text' && open.tools.length === 0 && !options.oneBot) {
            // Two text blocks in a row are one paragraph run.
            open.text = `${open.text}\n\n${text}`
            continue
          }
          close()
          open = {
            kind: 'text',
            key: keyFor(),
            messageId: m.id,
            text,
            thinking: pendingThinking,
            tools: [],
            queued: [],
            createdAt: m.created_at,
            position: 'single',
            isStreaming: false,
          }
          pendingThinking = []
          g.bubbles.push(open)
        }
        continue
      }
      if (block.type === 'tool_call') {
        if (!open) {
          open = {
            kind: 'keyboard-only',
            key: keyFor(),
            messageId: m.id,
            thinking: pendingThinking,
            tools: [],
            queued: [],
            createdAt: m.created_at,
            position: 'single',
            isStreaming: false,
          }
          pendingThinking = []
          g.bubbles.push(open)
        }
        open.tools.push(block.data)
        open.queued.push(nextQueued())
        continue
      }
      if (block.type === 'sticker') {
        close()
        g.bubbles.push({
          kind: 'sticker',
          key: keyFor(),
          messageId: m.id,
          stickerId: block.sticker_id,
          name: block.name ?? null,
          createdAt: m.created_at,
          position: 'single',
          isStreaming: false,
        })
      }
    }

    // Reasoning with nothing after it yet — the model is still thinking, or it
    // thought and then stopped. Either way it needs a keyboard to live on.
    if (pendingThinking.length > 0) {
      g.bubbles.push({
        kind: 'keyboard-only',
        key: keyFor(),
        messageId: m.id,
        thinking: pendingThinking,
        tools: [],
        queued: [],
        createdAt: m.created_at,
        position: 'single',
        isStreaming: false,
      })
    }
  }

  for (const g of groups) assignPositions(g.bubbles)

  if (turn.status === 'streaming') {
    const lastGroup = groups[groups.length - 1]
    const last = lastGroup.bubbles[lastGroup.bubbles.length - 1]
    if (last && last.kind !== 'sticker') last.isStreaming = true
  }

  return groups
}

/** Stickers sit outside the corner treatment: a group of `[text, sticker,
 *  text]` is two single bubbles with a picture between them, not a run whose
 *  middle happens to be a picture. */
function assignPositions(bubbles: BubbleModel[]): void {
  const runs: BubbleModel[][] = []
  let run: BubbleModel[] = []
  for (const b of bubbles) {
    if (b.kind === 'sticker') {
      if (run.length > 0) runs.push(run)
      run = []
      continue
    }
    run.push(b)
  }
  if (run.length > 0) runs.push(run)
  for (const r of runs) {
    if (r.length === 1) {
      r[0].position = 'single'
      continue
    }
    r.forEach((b, i) => {
      b.position = i === 0 ? 'first' : i === r.length - 1 ? 'last' : 'middle'
    })
  }
}

function hideThinkingForSearchOnly(blocks: ContentBlock[]): ContentBlock[] {
  const hasWebSearch = blocks.some((b) => b.type === 'tool_call' && b.data.tool_name === 'web_search')
  if (!hasWebSearch) return blocks
  const hasText = blocks.some((b) => b.type === 'text' && b.text.trim())
  return hasText ? blocks : blocks.filter((b) => b.type !== 'thinking')
}

/** The `\n---\n` bubble-splitting protocol, as a OneBot reply uses it. */
function splitOneBot(text: string): string[] {
  const segments = text
    .split(/\n---\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  return segments.length > 0 ? segments : [text]
}

/**
 * Whether the turn is between a tool returning and the model speaking again.
 *
 * Nothing in the viewport moves then: the answer has not started, and the
 * reader has long since scrolled past whatever said "processing". Approving a
 * call lands exactly here — the decision row resolves and the screen goes
 * still, leaving the stop button as the only sign the turn is alive. This is
 * what tells the transcript to put a sign where the reader is looking.
 *
 * Not while the model is visibly thinking, whose own panel is already the
 * sign; and not for a turn waiting on the user, which is not alive in the
 * sense that matters here. A turn that has produced nothing at all counts —
 * that is the first second after the question, and the longest-feeling one.
 */
export function awaitingModel(turn: Turn): boolean {
  if (turn.status !== 'streaming' || turn.result) return false
  const last = turn.assistantMessages[turn.assistantMessages.length - 1]
  if (!last) return true
  const blocks = blocksOf(last)
  const tail = blocks[blocks.length - 1]
  return !tail || tail.type === 'tool_call'
}

/** The text a copy of the whole answer should carry: every bubble's prose, in
 *  order, and nothing else. Keyboards, reasoning and stickers are not prose. */
export function groupsPlainText(groups: AssistantGroup[]): string {
  const parts: string[] = []
  for (const g of groups) {
    for (const b of g.bubbles) {
      if (b.kind === 'text') parts.push(b.text)
    }
  }
  return parts.join('\n\n')
}
