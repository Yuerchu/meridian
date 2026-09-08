// Dev-only harness for the transcript's scroll behaviour. Reachable at
// #playground/scroll from a plain browser; never included in production builds.
//
// The scroller only misbehaves against real rows: its decisions come from
// measured heights, from when items mount, and from whether an item's identity
// survived a reload. A stand-in list of coloured boxes reproduces none of that,
// so this drives the same `ChatTranscript` the product renders, with synthetic
// messages shaped like the ones the backend streams.
//
// Every action is also exposed on `window.__scrollLab` so a browser driver can
// step through a scenario deterministically instead of racing a timer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@heroui/react'
import { ChatTranscript } from '@/components/chat/chat-transcript'
import { useTurns } from '@/hooks/use-turns'
import { useAppTheme } from '@/lib/theme'
import type { ContentBlock, MessageViewModel, ToolCallDisplay } from '@/types'

const LAB_CONVERSATION = 'scroll-lab'

const SHORT_QUESTION = '这段滚动逻辑该怎么改？'

const LONG_QUESTION = [
  '我贴一段完整的报错和上下文，你看看问题出在哪。',
  '',
  '现在的现象是：发完消息之后视口就不动了，助手明明在写，但屏幕上一个字都没有变化。',
  '往下滚才能看到内容已经写了一大截。工具调用也是一样，卡片是出现了，只是出现在屏幕外面。',
  '',
  '复现步骤：',
  '1. 打开一个已有的会话，随便滚到中间某个位置',
  '2. 在输入框里粘一段比较长的内容，长到超过一屏',
  '3. 发送，观察视口',
  '',
  '期望：助手开始写的时候视口跟着往下走，能看到最新的内容。',
  '实际：视口停在我这条消息的顶部，一直到回答结束都没动过。',
  '',
  '另外还有一个更奇怪的：偶尔回答结束的那一瞬间，整个页面会突然滚到对话的最开头，',
  '就是第一条消息那里。不是每次都有，但打开旧会话之后发第一条消息基本必现。',
  '',
  '补充一句，如果我在助手写的过程中自己往上滚去看历史，它有时候还会把我拽回去，',
  '这个也很影响阅读。',
].join('\n')

const ANSWER_CHUNKS = [
  '我先看一下现在的实现。',
  '\n\n问题出在滚动状态机上：新的一轮开始时视口会锚定到你的提问顶部，',
  '之后助手的输出都发生在同一个 DOM 节点内部，',
  '不会触发列表变更，只会触发尺寸变更。',
  '\n\n而尺寸变更在锚定状态下做的事情是**重新锚定回原位**，',
  '所以视口就一直钉在那里不动了。',
  '\n\n正常情况下这个状态会在内容填满一屏之后自动解除，',
  '但你的提问本身就超过一屏，解除条件永远不成立。',
  '\n\n```ts\nif (mode === "anchored" && spacerBefore > 0 && spacer === 0) {\n  scrollToEnd()\n}\n```\n\n',
  '上面这段就是解除条件。`spacerBefore` 一开始就是 0，所以它永远不会执行。',
  '\n\n我的建议是把跟随策略反过来：默认跟随底部，',
  '只有在你主动往上滚之后才停下来。',
]

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

function message(
  over: Partial<MessageViewModel> & Pick<MessageViewModel, 'id' | 'role' | 'content'>,
): MessageViewModel {
  return {
    conversation_id: LAB_CONVERSATION,
    provider_id: 'openai',
    model_id: 'gpt-5.6-sol',
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    provider_name: null,
    tool_calls: null,
    tool_call_id: null,
    sort_order: 0,
    created_at: Date.now(),
    reasoning_content: null,
    rating: null,
    is_compact_summary: false,
    sender_id: null,
    parent_id: null,
    compact_anchor_id: null,
    source: null,
    turn_id: null,
    tool_outcome: null,
    auto_review: null,
    context_items: [],
    ...over,
  }
}

function toolBlock(over: Partial<ToolCallDisplay> & Pick<ToolCallDisplay, 'tool_name' | 'status'>): ContentBlock {
  return {
    type: 'tool_call',
    data: { call_id: nextId('call'), arguments: '{}', ...over },
  }
}

/** Replaces the last assistant row, leaving every other row's identity alone. */
function withLastAssistant(
  messages: MessageViewModel[],
  edit: (m: MessageViewModel) => MessageViewModel,
): MessageViewModel[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      const out = messages.slice()
      out[i] = edit(messages[i])
      return out
    }
  }
  return messages
}

function appendBlock(m: MessageViewModel, block: ContentBlock): MessageViewModel {
  return { ...m, _blocks: [...(m._blocks ?? []), block] }
}

export interface ScenarioResult {
  name: string
  pass: boolean
  detail: string
}

interface LabApi {
  reset: () => void
  seedHistory: (turns?: number) => void
  sendUser: (long?: boolean | number) => void
  startAssistant: () => void
  streamChunk: (index?: number) => void
  streamAll: () => void
  callTool: (name?: string) => void
  finishTool: () => void
  /** Ends the turn the way `handleStop` does: the reload swaps the optimistic
   *  `temp-user-*` row for the persisted one, changing the turn's identity. */
  finishTurn: () => void
  /** Runs every scenario in order and reports what each one observed. */
  runScenarios: () => Promise<ScenarioResult[]>
  metrics: () => {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    distanceFromBottom: number
    scrollable: string | null
    mode: string | null
    firstTurnTop: number | null
    lastAnswerTop: number | null
  }
}

declare global {
  interface Window {
    __scrollLab?: LabApi
  }
}

export default function ScrollLab() {
  // Through `setTheme` rather than toggling the class directly: the hook keeps
  // its own record of what it wrote, and a class it did not write is a class it
  // will not remove.
  const { resolvedTheme, setTheme } = useAppTheme()
  const [messages, setMessages] = useState<MessageViewModel[]>([])
  const [streaming, setStreaming] = useState(false)
  const chunkRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const [readout, setReadout] = useState('')
  const [results, setResults] = useState<ScenarioResult[] | null>(null)
  const [hasTrailingRow, setHasTrailingRow] = useState(false)
  // Bumped to remount the transcript. The scroller keeps its mode outside React
  // state, so clearing the messages alone would carry `follow` from the previous
  // scenario into the next one and quietly decide its outcome.
  const [generation, setGeneration] = useState(0)

  const turns = useTurns(messages, streaming)

  const viewport = useCallback(
    () => rootRef.current?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]') ?? null,
    [],
  )

  const reset = useCallback(() => {
    setMessages([])
    setStreaming(false)
    chunkRef.current = 0
    setHasTrailingRow(false)
    setGeneration((g) => g + 1)
  }, [])

  const seedHistory = useCallback((count = 6) => {
    const seeded: MessageViewModel[] = []
    for (let i = 0; i < count; i++) {
      seeded.push(
        message({
          id: nextId('seed-user'),
          role: 'user',
          content: `历史提问 ${i + 1}：${SHORT_QUESTION}`,
          sort_order: seeded.length,
        }),
      )
      seeded.push(
        message({
          id: nextId('seed-assistant'),
          role: 'assistant',
          content: '',
          sort_order: seeded.length,
          _blocks: [
            { type: 'text', text: `历史回答 ${i + 1}。\n\n` + ANSWER_CHUNKS.slice(0, 6).join('') },
            // Every other answer carries a call, so a long seeded history
            // exercises the keyboard and its panels, not just prose.
            ...(i % 2 === 1
              ? [
                  {
                    type: 'tool_call' as const,
                    data: {
                      call_id: nextId('seed-call'),
                      tool_name: 'read_file',
                      arguments: JSON.stringify({ path: `src/history/${i}.ts` }),
                      status: 'completed' as const,
                      result: 'export const seeded = true\n'.repeat(12),
                    },
                  },
                ]
              : []),
          ],
        }),
      )
    }
    setMessages(seeded)
    setStreaming(false)
    chunkRef.current = 0
  }, [])

  /** `long` may be a repeat count: 1 is roughly one screen, 3 is well past it,
   *  which is the case where the anchored viewport has no room left to give. */
  const sendUser = useCallback((long: boolean | number = false) => {
    const repeat = long === true ? 1 : long === false ? 0 : long
    const id = nextId('temp-user')
    setMessages((prev) => [
      ...prev,
      message({
        // Same shape as the optimistic row `chat-view` inserts before the
        // backend has persisted anything.
        id,
        role: 'user',
        content: repeat === 0 ? SHORT_QUESTION : Array.from({ length: repeat }, () => LONG_QUESTION).join('\n\n'),
        sort_order: prev.length,
      }),
    ])
    setStreaming(true)
    chunkRef.current = 0
  }, [])

  const startAssistant = useCallback(() => {
    setMessages((prev) => [
      ...prev,
      message({ id: nextId('assistant'), role: 'assistant', content: '', sort_order: prev.length }),
    ])
    setStreaming(true)
  }, [])

  const streamChunk = useCallback((index?: number) => {
    const at = index ?? chunkRef.current
    chunkRef.current = at + 1
    const text = ANSWER_CHUNKS[at % ANSWER_CHUNKS.length]
    setMessages((prev) =>
      withLastAssistant(prev, (m) => {
        const blocks = m._blocks ?? []
        const last = blocks[blocks.length - 1]
        if (last?.type === 'text') {
          return { ...m, _blocks: [...blocks.slice(0, -1), { type: 'text', text: last.text + text }] }
        }
        return appendBlock(m, { type: 'text', text })
      }),
    )
  }, [])

  const streamAll = useCallback(() => {
    for (let i = 0; i < ANSWER_CHUNKS.length; i++) streamChunk(i)
  }, [streamChunk])

  const callTool = useCallback((name = 'read_file') => {
    setMessages((prev) =>
      withLastAssistant(prev, (m) =>
        appendBlock(
          m,
          toolBlock({
            tool_name: name,
            status: 'running',
            arguments: JSON.stringify({ path: `src/components/ui/message-scroller.tsx` }),
          }),
        ),
      ),
    )
  }, [])

  const finishTool = useCallback(() => {
    setMessages((prev) =>
      withLastAssistant(prev, (m) => {
        const blocks = m._blocks ?? []
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i]
          if (b.type === 'tool_call' && b.data.status === 'running') {
            const next = blocks.slice()
            next[i] = {
              type: 'tool_call',
              data: { ...b.data, status: 'completed', result: '共 137 行，其中 42 行与滚动状态机相关。' },
            }
            return { ...m, _blocks: next }
          }
        }
        return m
      }),
    )
  }, [])

  const finishTurn = useCallback(() => {
    setStreaming(false)
    // Two steps, like the real thing: `handleStop` flips the flag immediately
    // and the reload that swaps the optimistic row for the persisted one lands
    // a round-trip later. Doing both at once would hide anything that depends
    // on the row being re-keyed after the turn has already ended.
    setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m.id.startsWith('temp-user-') ? { ...m, id: nextId('user') } : m)))
    }, 60)
  }, [])

  const metrics = useCallback(() => {
    const vp = viewport()
    const content = rootRef.current?.querySelector<HTMLElement>('[data-slot="message-scroller-content"]')
    const items = content
      ? Array.from(content.querySelectorAll<HTMLElement>('[data-slot="message-scroller-item"]'))
      : []
    const vpTop = vp?.getBoundingClientRect().top ?? 0
    const answers = content?.querySelectorAll<HTMLElement>('[data-message-anchor]')
    const lastAnswer = answers?.[answers.length - 1] ?? null
    return {
      scrollTop: Math.round(vp?.scrollTop ?? 0),
      scrollHeight: Math.round(vp?.scrollHeight ?? 0),
      clientHeight: Math.round(vp?.clientHeight ?? 0),
      distanceFromBottom: Math.round((vp?.scrollHeight ?? 0) - (vp?.scrollTop ?? 0) - (vp?.clientHeight ?? 0)),
      scrollable: vp?.getAttribute('data-scrollable') ?? null,
      mode: vp?.getAttribute('data-scroll-mode') ?? null,
      firstTurnTop: items[0] ? Math.round(items[0].getBoundingClientRect().top - vpTop) : null,
      lastAnswerTop: lastAnswer ? Math.round(lastAnswer.getBoundingClientRect().top - vpTop) : null,
    }
  }, [viewport])

  /**
   * The behaviours this scroller exists to get right, as executable statements.
   *
   * Each one is a bug that was real: the viewport pinned to a question longer
   * than the screen while the answer was written off it, the jump to the top of
   * the conversation when a finished turn was re-keyed by its reload, and the
   * reader being dragged away from what they were reading.
   */
  const runScenarios = useCallback(async (): Promise<ScenarioResult[]> => {
    const frames = (n: number) =>
      new Promise<void>((resolve) => {
        let i = 0
        const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      })
    // Long enough for the turn to collapse and the re-key to land.
    const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 1200))
    const wheelUp = (distance: number) => {
      const vp = viewport()
      if (!vp) return
      vp.dispatchEvent(new WheelEvent('wheel', { deltaY: -distance, bubbles: true }))
      vp.scrollTop -= distance
    }
    const out: ScenarioResult[] = []

    // 1. A question taller than the viewport still lets the answer be seen.
    reset()
    await frames(4)
    seedHistory(3)
    await frames(8)
    sendUser(3)
    await frames(8)
    startAssistant()
    await frames(6)
    const followed: number[] = []
    for (let i = 0; i < 4; i++) {
      streamChunk(i)
      await frames(4)
      followed.push(metrics().distanceFromBottom)
    }
    callTool()
    await frames(6)
    followed.push(metrics().distanceFromBottom)
    finishTool()
    await frames(6)
    followed.push(metrics().distanceFromBottom)
    // Written out twice so the answer clears the viewport with room to spare —
    // the next scenario is about going back to a beginning that has scrolled
    // away, and it has to still be away once the turn collapses.
    for (let i = 4; i < ANSWER_CHUNKS.length * 2; i++) {
      streamChunk(i)
      await frames(4)
      followed.push(metrics().distanceFromBottom)
    }
    const worst = Math.max(...followed)
    out.push({
      name: '超长提问：流式与工具调用始终可见',
      pass: worst <= 8,
      detail: `每次内容到达后距底最大 ${worst}px（应 ≤ 8）`,
    })

    // 2. Ending a turn hands the answer back at its beginning.
    //
    // Streamed from scratch rather than continuing the turn above, so this
    // scenario owns its state: the assertion is about where a turn lands, and
    // inheriting a viewport that another scenario left somewhere makes a
    // failure here impossible to read.
    reset()
    await frames(4)
    seedHistory(3)
    await frames(8)
    sendUser(3)
    await frames(8)
    startAssistant()
    await frames(6)
    for (let i = 0; i < 4; i++) {
      streamChunk(i)
      await frames(4)
    }
    callTool()
    await frames(6)
    finishTool()
    await frames(6)
    // Three times through, so the answer clears the viewport with room to
    // spare. Twice used to be enough, while the tool card stayed open after
    // its result landed; the keyboard shuts its panel as soon as the tool
    // returns, which is right, and takes the card's height off the answer.
    // An answer that fits the viewport is *meant* to stay put at the end of
    // a turn (scenario 4), so this one has to be long enough not to.
    for (let i = 4; i < ANSWER_CHUNKS.length * 3; i++) {
      streamChunk(i)
      await frames(4)
    }
    finishTurn()
    await settled()
    const settledAt = metrics()
    out.push({
      name: '回合结束：回到答案开头且交还控制权',
      pass:
        settledAt.mode === 'idle' &&
        settledAt.lastAnswerTop !== null &&
        settledAt.lastAnswerTop >= 0 &&
        settledAt.lastAnswerTop < 200,
      detail: `答案顶部在视口 ${settledAt.lastAnswerTop}px 处，mode=${settledAt.mode}（应为 0–200 且 idle）`,
    })
    out.push({
      name: '回合结束：不会跳到对话开头',
      pass: settledAt.scrollTop > 0,
      detail: `scrollTop=${settledAt.scrollTop}（旧实现在这里归零）`,
    })

    // 3. A reader who scrolled away is left where they are, to the end.
    reset()
    await frames(4)
    seedHistory(4)
    await frames(8)
    sendUser(false)
    await frames(6)
    startAssistant()
    await frames(4)
    for (let i = 0; i < 5; i++) {
      streamChunk(i)
      await frames(3)
    }
    wheelUp(700)
    await frames(4)
    const parked = metrics().scrollTop
    for (let i = 5; i < 10; i++) {
      streamChunk(i)
      await frames(3)
    }
    callTool('run_command')
    await frames(4)
    finishTool()
    await frames(4)
    const duringRead = metrics().scrollTop
    finishTurn()
    await settled()
    const afterRead = metrics().scrollTop
    out.push({
      name: '读到一半：流式与回合结束都不搬动读者',
      pass: duringRead === parked && afterRead === parked,
      detail: `停在 ${parked}，流式中 ${duringRead}，结束后 ${afterRead}`,
    })

    // 4. An answer that never left the screen has nowhere to go back to.
    reset()
    await frames(4)
    seedHistory(4)
    await frames(8)
    sendUser(false)
    await frames(6)
    startAssistant()
    await frames(4)
    streamChunk(0)
    await frames(4)
    streamChunk(1)
    await frames(4)
    const beforeShort = metrics().scrollTop
    finishTurn()
    await settled()
    const afterShort = metrics().scrollTop
    out.push({
      name: '短答案：结束时不做多余滚动',
      pass: Math.abs(afterShort - beforeShort) <= 2,
      detail: `${beforeShort} → ${afterShort}`,
    })

    // 5. Returning to the live edge re-arms following.
    reset()
    await frames(4)
    seedHistory(4)
    await frames(8)
    sendUser(false)
    await frames(6)
    startAssistant()
    await frames(4)
    for (let i = 0; i < 6; i++) {
      streamChunk(i)
      await frames(3)
    }
    wheelUp(900)
    await frames(4)
    const button = rootRef.current?.querySelector<HTMLButtonElement>('[data-slot="message-scroller-button"]')
    const offered = button?.getAttribute('data-active') === 'true'
    button?.click()
    await settled()
    streamChunk(7)
    await frames(4)
    const resumed = metrics()
    out.push({
      name: '回到最新：按钮出现，点完继续跟随',
      pass: offered && resumed.mode === 'follow' && resumed.distanceFromBottom <= 8,
      detail: `按钮可用=${offered}，点后 mode=${resumed.mode}，距底 ${resumed.distanceFromBottom}`,
    })

    // 6. A turn is inserted before status/decorative rows, not necessarily at
    // the previous child count. Sending it still overrides an idle reader.
    reset()
    await frames(4)
    setHasTrailingRow(true)
    await frames(4)
    seedHistory(6)
    await frames(8)
    wheelUp(700)
    await frames(4)
    const beforeSend = metrics()
    sendUser(false)
    await frames(6)
    startAssistant()
    await frames(4)
    streamChunk(0)
    await frames(4)
    const afterSend = metrics()
    out.push({
      name: '尾部有状态行：发送新回合仍恢复跟随',
      pass: beforeSend.mode === 'idle' && afterSend.mode === 'follow' && afterSend.distanceFromBottom <= 8,
      detail: `${beforeSend.mode} → ${afterSend.mode}，距底 ${afterSend.distanceFromBottom}`,
    })

    // 7. Gestures towards the live edge and keys owned by a nested control are
    // not departures. Neither emits a viewport scroll event at the bottom, so
    // an eager "any input means idle" policy freezes the next chunk.
    reset()
    await frames(4)
    sendUser(false)
    await frames(6)
    startAssistant()
    await frames(4)
    streamChunk(0)
    await frames(4)
    const vp = viewport()
    vp?.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }))
    const rowButton = vp?.querySelector<HTMLButtonElement>('button')
    rowButton?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    await frames(3)
    streamChunk(1)
    await frames(4)
    const afterHarmlessInput = metrics()
    out.push({
      name: '已在底部：向下滚与行内按钮按键不解除跟随',
      pass: rowButton != null && afterHarmlessInput.mode === 'follow' && afterHarmlessInput.distanceFromBottom <= 8,
      detail: `行内按钮=${rowButton != null}，mode=${afterHarmlessInput.mode}，距底 ${afterHarmlessInput.distanceFromBottom}`,
    })

    // 7b. Following the stream is a jump per chunk, not a journey: the viewport
    // must not put on its "autoscrolling" face — which hides the scrollbar
    // thumb — for any of them, or the thumb blinks at the reader for as long
    // as the answer streams. Only a smooth scroll earns the attribute.
    reset()
    await frames(4)
    seedHistory(3)
    await frames(8)
    sendUser(false)
    await frames(6)
    startAssistant()
    await frames(4)
    let thumbHidden = 0
    const vpForThumb = viewport()
    const thumbObserver =
      vpForThumb &&
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName === 'data-autoscrolling' && vpForThumb.hasAttribute('data-autoscrolling')) {
            thumbHidden += 1
          }
        }
      })
    if (vpForThumb && thumbObserver) thumbObserver.observe(vpForThumb, { attributes: true })
    for (let i = 0; i < 6; i++) {
      streamChunk(i)
      await frames(3)
    }
    thumbObserver?.disconnect()
    const whileStreaming = metrics()
    out.push({
      name: '已在底部：跟随流式不隐藏滚动条',
      pass: thumbObserver != null && thumbHidden === 0 && whileStreaming.mode === 'follow',
      detail: `拇指隐藏 ${thumbHidden} 次，mode=${whileStreaming.mode}`,
    })
    finishTurn()
    await settled()

    // 8. More anchored DOM does not necessarily mean the user sent a turn. A
    // longer branch or a refreshed history path can add rows while no answer is
    // live, and must leave an idle reader exactly where they were.
    reset()
    await frames(4)
    seedHistory(5)
    await frames(8)
    wheelUp(650)
    await frames(4)
    const beforeInactiveAppend = metrics()
    setMessages((prev) => [
      ...prev,
      message({
        id: nextId('persisted-user'),
        role: 'user',
        content: '另一条已经完成的历史分支。',
        sort_order: prev.length,
      }),
      message({
        id: nextId('persisted-assistant'),
        role: 'assistant',
        content: '这是从存储快照载入的答案，不是正在发生的新回合。',
        sort_order: prev.length + 1,
      }),
    ])
    await frames(8)
    const afterInactiveAppend = metrics()
    out.push({
      name: '分支或历史变长：非流式追加不抢走阅读位置',
      pass:
        beforeInactiveAppend.mode === 'idle' &&
        afterInactiveAppend.mode === 'idle' &&
        afterInactiveAppend.scrollTop === beforeInactiveAppend.scrollTop,
      detail: `mode ${beforeInactiveAppend.mode} → ${afterInactiveAppend.mode}，scrollTop ${beforeInactiveAppend.scrollTop} → ${afterInactiveAppend.scrollTop}`,
    })

    // 9. Mounting onto a turn that is already running is itself a live signal.
    // The default "last anchor" opening position may be the answer's beginning;
    // follow must win once for an active conversation so new chunks are visible.
    reset()
    await frames(4)
    const activeMessages: MessageViewModel[] = []
    for (let i = 0; i < 5; i++) {
      activeMessages.push(
        message({
          id: nextId('active-history-user'),
          role: 'user',
          content: `运行中会话的历史提问 ${i + 1}`,
          sort_order: activeMessages.length,
        }),
        message({
          id: nextId('active-history-assistant'),
          role: 'assistant',
          content: ANSWER_CHUNKS.slice(0, 5).join(''),
          sort_order: activeMessages.length + 1,
        }),
      )
    }
    activeMessages.push(
      message({
        id: nextId('active-user'),
        role: 'user',
        content: SHORT_QUESTION,
        sort_order: activeMessages.length,
      }),
      message({
        id: nextId('active-assistant'),
        role: 'assistant',
        content: Array.from({ length: 3 }, () => ANSWER_CHUNKS.join('')).join('\n\n'),
        sort_order: activeMessages.length + 1,
      }),
    )
    setMessages(activeMessages)
    setStreaming(true)
    setGeneration((g) => g + 1)
    await frames(10)
    const openedActive = metrics()
    streamChunk(2)
    await frames(4)
    const streamedActive = metrics()
    out.push({
      name: '打开运行中会话：初次挂载直接跟到实时边缘',
      pass:
        openedActive.mode === 'follow' &&
        openedActive.distanceFromBottom <= 8 &&
        streamedActive.mode === 'follow' &&
        streamedActive.distanceFromBottom <= 8,
      detail: `打开 mode=${openedActive.mode}/距底 ${openedActive.distanceFromBottom}，新块后 mode=${streamedActive.mode}/距底 ${streamedActive.distanceFromBottom}`,
    })

    return out
  }, [callTool, finishTool, finishTurn, metrics, reset, seedHistory, sendUser, startAssistant, streamChunk, viewport])

  const api = useMemo<LabApi>(
    () => ({
      reset,
      seedHistory,
      sendUser,
      startAssistant,
      streamChunk,
      streamAll,
      callTool,
      finishTool,
      finishTurn,
      runScenarios,
      metrics,
    }),
    [
      reset,
      seedHistory,
      sendUser,
      startAssistant,
      streamChunk,
      streamAll,
      callTool,
      finishTool,
      finishTurn,
      runScenarios,
      metrics,
    ],
  )

  useEffect(() => {
    window.__scrollLab = api
    return () => {
      delete window.__scrollLab
    }
  }, [api])

  // Polled rather than pushed: scroll position is tracked imperatively inside
  // the scroller, so there is no render to hook into.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const m = metrics()
      setReadout(
        `scrollTop ${m.scrollTop} · 距底 ${m.distanceFromBottom} · 视口 ${m.clientHeight} · ` +
          `内容 ${m.scrollHeight} · scrollable=${m.scrollable ?? '—'} · ` +
          `首轮顶 ${m.firstTurnTop ?? '—'} · 末答顶 ${m.lastAnswerTop ?? '—'}`,
      )
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [metrics])

  return (
    <div data-slot="scroll-lab" ref={rootRef} className="flex h-screen flex-col bg-background text-foreground">
      <div data-slot="scroll-lab-toolbar" className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span data-slot="scroll-lab-title" className="text-sm font-semibold">
          滚动行为实验场
        </span>
        <Button size="sm" variant="outline" onPress={() => seedHistory()}>
          铺历史
        </Button>
        {/* Well past the transcript's window, so what this measures is the
            cost of a long conversation as the product actually renders one. */}
        <Button size="sm" variant="outline" onPress={() => seedHistory(200)}>
          铺 200 轮
        </Button>
        <Button size="sm" variant="outline" onPress={() => setHasTrailingRow((v) => !v)}>
          尾部状态行
        </Button>
        <Button size="sm" variant="outline" onPress={() => sendUser(false)}>
          发短消息
        </Button>
        <Button size="sm" variant="outline" onPress={() => sendUser(true)}>
          发长消息
        </Button>
        <Button size="sm" variant="outline" onPress={() => sendUser(3)}>
          发超长消息
        </Button>
        <Button size="sm" variant="outline" onPress={startAssistant}>
          助手开始
        </Button>
        <Button size="sm" variant="outline" onPress={() => streamChunk()}>
          流式一块
        </Button>
        <Button size="sm" variant="outline" onPress={streamAll}>
          流式到底
        </Button>
        <Button size="sm" variant="outline" onPress={() => callTool()}>
          工具调用
        </Button>
        <Button size="sm" variant="outline" onPress={finishTool}>
          工具返回
        </Button>
        <Button size="sm" variant="outline" onPress={finishTurn}>
          结束本轮
        </Button>
        <Button size="sm" variant="ghost" onPress={reset}>
          清空
        </Button>
        <Button
          size="sm"
          onPress={() => {
            setResults(null)
            runScenarios().then(setResults)
          }}
        >
          跑全部场景
        </Button>
        <Button size="sm" variant="ghost" onPress={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          主题
        </Button>
      </div>

      <ChatTranscript
        key={generation}
        turns={turns}
        conversationId={LAB_CONVERSATION}
        streaming={streaming}
        // A real transcript often has an error/compaction row after its turns.
        // Scenario 6 turns this on so new-turn detection cannot assume that an
        // appended turn starts at the old direct-child count.
        trailing={
          hasTrailingRow ? (
            <div data-slot="scroll-lab-trailing-row" aria-hidden="true" className="h-px shrink-0" />
          ) : null
        }
        scrollToBottomLabel="回到最新"
      />

      {results && (
        <div
          data-slot="scroll-lab-results"
          data-testid="scroll-lab-results"
          className="max-h-48 overflow-y-auto border-t px-4 py-2 text-xs"
        >
          {results.map((r) => (
            <div data-slot="scroll-lab-result" key={r.name} className="flex gap-2 py-0.5">
              <span
                data-slot="scroll-lab-result-verdict"
                className={r.pass ? 'text-success-soft-foreground' : 'text-danger'}
              >
                {r.pass ? 'PASS' : 'FAIL'}
              </span>
              <span data-slot="scroll-lab-result-name" className="font-medium">
                {r.name}
              </span>
              <span data-slot="scroll-lab-result-detail" className="text-muted">
                {r.detail}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        data-slot="scroll-lab-readout"
        data-testid="scroll-lab-readout"
        className="border-t px-4 py-2 font-mono text-xs text-muted"
      >
        {readout}
      </div>
    </div>
  )
}
