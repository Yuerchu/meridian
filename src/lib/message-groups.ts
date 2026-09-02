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

/** The three kinds of call that are folded into a badge rather than drawn as
 *  keys. Their order is the order the badges are drawn in. */
export type FoldKind = 'commands' | 'files' | 'searches'

/**
 * Calls the reader did not need to see one by one: a run of file reads, of
 * searches, of commands that ran and returned. Drawn as one badge under the
 * bubble's prose — "viewed 10 files" — that opens into the keys on demand.
 *
 * The calls themselves are here, in order, so opening the badge draws exactly
 * the keys that would otherwise have been on the keyboard. Until then nothing
 * of them is rendered, which is what this is for: a research turn reads sixty
 * files, and sixty closed panels each holding a highlighted file is a page
 * that stops scrolling.
 */
export interface FoldedCalls {
  kind: FoldKind
  /** Stable across re-renders and reloads: the first folded call's id. */
  key: string
  tools: ToolCallDisplay[]
  /** What the badge says it did: distinct files for reads, calls otherwise. */
  count: number
}

export type BubbleModel =
  | {
      kind: 'text'
      key: string
      messageId: string
      /** One Markdown segment. A OneBot reply splits on `\n---\n` into several
       *  bubbles, which is why this is a segment rather than the whole block. */
      text: string
      thinking: string[]
      /** The calls drawn as keys. Folded ones are in `folded` instead. */
      tools: ToolCallDisplay[]
      /** `markQueued` over the whole turn, sliced to this bubble's keys. */
      queued: boolean[]
      folded: FoldedCalls[]
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
      folded: FoldedCalls[]
      createdAt: number
      position: BubblePosition
      isStreaming: boolean
    }
  | {
      /** A row that did nothing but folded calls, with no prose before it to
       *  hang the badges under and no key left to draw: a bubble holding only
       *  the badges and the time. */
      kind: 'summary'
      key: string
      messageId: string
      folded: FoldedCalls[]
      createdAt: number
      position: BubblePosition
      isStreaming: false
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
  | {
      /** The model is between a tool returning and speaking again. Drawn as
       *  the next bubble of the run with a spinner in it — the typing
       *  indicator — so the sign of life is where the answer will appear and
       *  the avatar sits beside it. See `awaitingModel`. */
      kind: 'working'
      key: string
      messageId: string | null
      createdAt: number
      position: BubblePosition
      isStreaming: true
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
 * Which calls fold, by tool name. The capitalised names are Claude Code's,
 * reaching us through a hosted session.
 *
 * The test is that the call is low-risk *and* finished: a read, a search, or
 * a command that has already run and returned — which for a command means it
 * was approved, or allowed by a rule the user set. Nothing that writes, nothing
 * that reaches the network on its own account (`web_search` carries sources
 * the reader was promised, `WebFetch` is a request to an arbitrary host), and
 * nothing from MCP or the custom registry, whose names say nothing about what
 * they do.
 */
const FOLD_KIND: Record<string, FoldKind> = {
  run_command: 'commands',
  Bash: 'commands',
  read_file: 'files',
  Read: 'files',
  search_files: 'searches',
  glob: 'searches',
  Glob: 'searches',
  Grep: 'searches',
  list_directory: 'searches',
}

const FOLD_ORDER: FoldKind[] = ['commands', 'files', 'searches']

/** A call that needs nothing more from anyone is folded; every other state —
 *  waiting, running, refused, failed, cut off — is a key, because each of
 *  those is something the reader may need to see or act on. */
export function foldKindOf(tool: ToolCallDisplay): FoldKind | null {
  if (tool.status !== 'completed') return null
  return FOLD_KIND[tool.tool_name] ?? null
}

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
  if (messages.length === 0) {
    // The first second after the question: nothing to draw but the sign that
    // something is coming, in a group of its own with the avatar beside it.
    return awaitingModel(turn) ? [workingGroup(turn, null)] : []
  }

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
            folded: [],
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
            folded: [],
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
        folded: [],
        createdAt: m.created_at,
        position: 'single',
        isStreaming: false,
      })
    }
  }

  for (const g of groups) g.bubbles = foldBubbles(g.bubbles)

  if (turn.status === 'streaming') {
    const lastGroup = groups[groups.length - 1]
    const last = lastGroup.bubbles[lastGroup.bubbles.length - 1]
    // Prose is being written only while nothing has followed it: a call after
    // the text means the text was finished before the call was made, and the
    // cursor has no business blinking in a sentence that ended a minute ago.
    // A keyboard with nothing on it yet is the thought still being written.
    if (last && last.kind === 'text' && last.tools.length === 0 && last.folded.length === 0) last.isStreaming = true
    if (last && last.kind === 'keyboard-only') last.isStreaming = true
  }

  if (awaitingModel(turn)) {
    const lastGroup = groups[groups.length - 1]
    const lastRow = messages[messages.length - 1]
    lastGroup.bubbles.push(workingBubble(turn, lastRow.id, lastRow.created_at))
  }

  for (const g of groups) assignPositions(g.bubbles)

  return groups
}

function workingBubble(turn: Turn, messageId: string | null, createdAt: number): BubbleModel {
  return { kind: 'working', key: `${turn.id}:working`, messageId, createdAt, position: 'single', isStreaming: true }
}

function workingGroup(turn: Turn, modelId: string | null): AssistantGroup {
  return {
    id: `${turn.id}:working`,
    modelId,
    bubbles: [workingBubble(turn, null, turn.userMessage?.created_at ?? 0)],
    messageIds: [],
  }
}

/**
 * Takes the low-risk finished calls off every keyboard and puts them on a
 * badge instead.
 *
 * A row that had nothing else — no prose, no reasoning, no key left once its
 * reads are folded — is not worth a bubble of its own. It joins the bubble
 * before it when that bubble can take badges *and* has no keys of its own:
 * badges sit under the prose and keys sit under the badges, so folding a row's
 * reads into a bubble that already has a key would draw them above a call
 * they were made after. Otherwise it stands as a summary bubble, which is a
 * bubble in the run for the corners' sake and a badge line for the reader's.
 */
function foldBubbles(bubbles: BubbleModel[]): BubbleModel[] {
  const out: BubbleModel[] = []
  for (const b of bubbles) {
    if (b.kind !== 'text' && b.kind !== 'keyboard-only') {
      out.push(b)
      continue
    }
    const keys: ToolCallDisplay[] = []
    const queued: boolean[] = []
    const byKind = new Map<FoldKind, ToolCallDisplay[]>()
    b.tools.forEach((tool, i) => {
      const kind = foldKindOf(tool)
      if (kind === null) {
        keys.push(tool)
        queued.push(b.queued[i])
        return
      }
      const list = byKind.get(kind)
      if (list) list.push(tool)
      else byKind.set(kind, [tool])
    })
    b.tools = keys
    b.queued = queued
    b.folded = FOLD_ORDER.flatMap((kind) => {
      const tools = byKind.get(kind)
      return tools ? [{ kind, key: `fold:${kind}:${tools[0].call_id}`, tools, count: countOf(kind, tools) }] : []
    })

    const bare = b.kind === 'keyboard-only' && b.tools.length === 0 && b.thinking.length === 0 && b.folded.length > 0
    if (!bare) {
      out.push(b)
      continue
    }
    const prev = out[out.length - 1]
    if (prev && ((prev.kind === 'text' && prev.tools.length === 0) || prev.kind === 'summary')) {
      prev.folded = mergeFolded(prev.folded, b.folded)
      continue
    }
    out.push({
      kind: 'summary',
      key: b.key,
      messageId: b.messageId,
      folded: b.folded,
      createdAt: b.createdAt,
      position: 'single',
      isStreaming: false,
    })
  }
  return out
}

function mergeFolded(into: FoldedCalls[], more: FoldedCalls[]): FoldedCalls[] {
  const byKind = new Map<FoldKind, ToolCallDisplay[]>()
  for (const f of [...into, ...more]) {
    const list = byKind.get(f.kind)
    if (list) list.push(...f.tools)
    else byKind.set(f.kind, [...f.tools])
  }
  return FOLD_ORDER.flatMap((kind) => {
    const tools = byKind.get(kind)
    return tools ? [{ kind, key: `fold:${kind}:${tools[0].call_id}`, tools, count: countOf(kind, tools) }] : []
  })
}

/** "Viewed 10 files" counts files, not reads: the same file read twice in two
 *  ranges is one file. A read whose path cannot be made out counts as one. */
function countOf(kind: FoldKind, tools: ToolCallDisplay[]): number {
  if (kind !== 'files') return tools.length
  const paths = new Set<string>()
  let unnamed = 0
  for (const tool of tools) {
    const path = pathOf(tool)
    if (path === null) unnamed += 1
    else paths.add(path)
  }
  return paths.size + unnamed
}

function pathOf(tool: ToolCallDisplay): string | null {
  try {
    const args: unknown = JSON.parse(tool.arguments)
    if (typeof args !== 'object' || args === null) return null
    const { path, file_path } = args as { path?: unknown; file_path?: unknown }
    const value = typeof path === 'string' ? path : typeof file_path === 'string' ? file_path : ''
    return value.trim() === '' ? null : value
  } catch {
    return null
  }
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
 * what puts a `working` bubble at the end of the run.
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
