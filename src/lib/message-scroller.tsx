import * as React from 'react'
import { dom } from '@heroui/react'

/**
 * The transcript scroller.
 *
 * Forked from `@shadcn/react/message-scroller`, keeping its parts, props and
 * data attributes, and replacing its scroll policy. The upstream policy anchors
 * a new turn to the top of the viewport and then *holds it there* for as long as
 * the answer streams, releasing only once an internal spacer has been consumed.
 * For a coding agent that is the wrong trade twice over: a question longer than
 * the viewport starts with no spacer at all, so the release never fires and the
 * whole answer — tool calls included — is written off-screen; and a turn whose
 * identity changes on reload (the optimistic user row being swapped for the
 * persisted one) re-triggers anchoring and jumps to the top of the conversation.
 *
 * The policy here is a two-state machine instead:
 *
 *   follow  the viewport stays pinned to the live edge
 *   idle    nothing moves the viewport but the reader
 *
 * Anchoring falls out of `follow` rather than competing with it. The spacer is
 * sized every frame so that the last turn's anchor can sit exactly `scrollMargin
 * + scrollPreviousItemPeek` below the top edge; while the answer is short,
 * "scrolled to the end" and "question at the top" are the same position, so a
 * new turn opens with its question at the top and the answer grows into the room
 * below it. As the answer outgrows the viewport the spacer shrinks to nothing and
 * the same follow keeps the live edge in view. A question taller than the
 * viewport simply starts with no spacer, and following still works.
 *
 * Nothing but an explicit command moves the viewport in `idle`, and every
 * reader-initiated scroll away from the live edge enters it.
 */

const DEFAULT_EDGE_THRESHOLD = 8
const DEFAULT_PREVIOUS_ITEM_PEEK = 64
const DEFAULT_SCROLL_MARGIN = 0
/** Sub-pixel scroll positions are never worth reacting to. */
const EPSILON = 0.5
/**
 * Backstop for a programmatic scroll that never reaches its target — the reader
 * grabbed the scrollbar mid-flight, or the browser clamped it. Normally the
 * flag is cleared by the scroll event that lands on the target, so this only
 * has to outlast a smooth scroll rather than time one.
 */
const AUTOSCROLL_TIMEOUT_MS = 1000
const SCROLL_AWAY_KEYS = new Set(['ArrowUp', 'Home', 'PageUp'])

export type ScrollAlign = 'start' | 'center' | 'end' | 'nearest'
export type DefaultScrollPosition = 'start' | 'end' | 'last-anchor'

export interface ScrollCommandOptions {
  align?: ScrollAlign
  behavior?: ScrollBehavior
  scrollMargin?: number
  /**
   * Skip the command unless the target has already been scrolled past.
   *
   * This is what makes "take me back to the top of the answer" safe to fire
   * unconditionally: an answer that still fits on screen is left alone rather
   * than dragged down to the top edge.
   */
  onlyWhenAbove?: boolean
}

export interface ScrollableState {
  start: boolean
  end: boolean
}

export interface VisibilityState {
  currentAnchorId: string | null
  visibleMessageIds: string[]
}

const NO_SCROLLABLE: ScrollableState = { start: false, end: false }
const NO_VISIBLE: string[] = []
const NO_VISIBILITY: VisibilityState = { currentAnchorId: null, visibleMessageIds: NO_VISIBLE }

/* ------------------------------------------------------------------ stores */

interface Store<T> {
  getSnapshot: () => T
  setSnapshot: (next: T) => void
  subscribe: (listener: () => void, onFirst?: () => void, onLast?: () => void) => () => void
  hasListeners: () => boolean
}

function createStore<T>(initial: T, equal: (a: T, b: T) => boolean): Store<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    setSnapshot: (next) => {
      if (equal(snapshot, next)) return
      snapshot = next
      listeners.forEach((l) => l())
    },
    subscribe: (listener, onFirst, onLast) => {
      const first = listeners.size === 0
      listeners.add(listener)
      if (first) onFirst?.()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) onLast?.()
      }
    },
    hasListeners: () => listeners.size > 0,
  }
}

function sameScrollable(a: ScrollableState, b: ScrollableState) {
  return a.start === b.start && a.end === b.end
}

function sameVisibility(a: VisibilityState, b: VisibilityState) {
  if (a.currentAnchorId !== b.currentAnchorId) return false
  if (a.visibleMessageIds.length !== b.visibleMessageIds.length) return false
  return a.visibleMessageIds.every((id, i) => id === b.visibleMessageIds[i])
}

/* -------------------------------------------------------------- geometry */

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  const live = refs.filter(Boolean)
  if (live.length === 0) return undefined
  return (value: T | null) => {
    for (const ref of live) {
      if (typeof ref === 'function') ref(value)
      else if (ref) (ref as React.RefObject<T | null>).current = value
    }
  }
}

function px(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function blockPadding(el: HTMLElement): { start: number; end: number } {
  const style = window.getComputedStyle(el)
  return {
    start: px(style.paddingBlockStart || style.paddingTop),
    end: px(style.paddingBlockEnd || style.paddingBottom),
  }
}

function rowGapOf(el: HTMLElement | null): number {
  if (!el) return 0
  const style = window.getComputedStyle(el)
  return px(style.rowGap === 'normal' ? style.gap : style.rowGap)
}

/** The transcript rows: every direct child of the content except the spacer. */
function itemsOf(content: HTMLElement, spacer: HTMLElement | null): HTMLElement[] {
  return Array.from(content.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child !== spacer,
  )
}

/** An element's top in the viewport's scroll coordinates. */
function offsetTopIn(el: HTMLElement, viewport: HTMLElement): number {
  return el.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
}

/** An element's top relative to the viewport's own top edge. */
function relativeTop(el: HTMLElement, viewport: HTMLElement): number {
  return el.getBoundingClientRect().top - viewport.getBoundingClientRect().top
}

/**
 * Where the transcript actually ends, ignoring the spacer.
 *
 * Read off the last row rather than `scrollHeight`, which already includes
 * whatever the spacer is currently contributing — the two are being solved for
 * together. Measured from the last row alone because this runs on every frame
 * of a stream, and walking hundreds of rows for a maximum that the last one
 * always holds in a flow layout is the kind of cost that shows up as jank in a
 * long conversation.
 */
function contentExtent(content: HTMLElement, spacer: HTMLElement | null, viewport: HTMLElement): number {
  const padding = blockPadding(content)
  const items = itemsOf(content, spacer)
  const last = items[items.length - 1]
  if (!last) return padding.start + padding.end
  const bottom = last.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top + viewport.scrollTop
  return Math.max(padding.start + padding.end, bottom + padding.end)
}

function lastAnchorOf(items: HTMLElement[]): HTMLElement | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].dataset.scrollAnchor === 'true') return items[i]
  }
  return null
}

function firstVisibleItem(content: HTMLElement, spacer: HTMLElement | null, viewport: HTMLElement): HTMLElement | null {
  const bounds = viewport.getBoundingClientRect()
  for (const item of itemsOf(content, spacer)) {
    if (!item.dataset.messageId) continue
    const rect = item.getBoundingClientRect()
    if (rect.bottom > bounds.top && rect.top < bounds.bottom) return item
  }
  return null
}

/* ---------------------------------------------------------------- context */

interface RegisterMessage {
  (messageId: string, element: HTMLElement | null, previous: HTMLElement | null, track: boolean): void
}

interface ScrollerContextValue {
  setRootElement: (el: HTMLDivElement | null) => void
  setViewportElement: (el: HTMLDivElement | null) => void
  setContentElement: (el: HTMLDivElement | null) => void
  setSpacerElement: (el: HTMLDivElement | null) => void
  viewportRef: React.RefObject<HTMLDivElement | null>
  preserveScrollOnPrependRef: React.RefObject<boolean>
  handleContentChange: () => void
  handleResize: () => void
  syncAfterScroll: () => void
  userScrollIntent: () => void
  scrollToEnd: (options?: ScrollCommandOptions) => boolean
  scrollToStart: (options?: ScrollCommandOptions) => boolean
  scrollToMessage: (messageId: string, options?: ScrollCommandOptions) => boolean
  isFollowing: () => boolean
  stateStore: Store<ScrollableState>
  visibilityStore: Store<VisibilityState>
  observeVisibility: () => void
  unobserveVisibility: () => void
}

const ScrollerContext = React.createContext<ScrollerContextValue | null>(null)
const RegisterContext = React.createContext<RegisterMessage | null>(null)

function useScrollerContext(): ScrollerContextValue {
  const context = React.useContext(ScrollerContext)
  if (!context) throw new Error('useMessageScroller must be used within a MessageScroller.')
  return context
}

/* ------------------------------------------------------------------ state */

type ScrollMode = 'follow' | 'idle'

export interface MessageScrollerProviderProps {
  children?: React.ReactNode
  /** Follow the live edge while the reader is at it. */
  autoScroll?: boolean
  /**
   * A product-level signal that a new live turn has started.
   *
   * When supplied, changing to a non-null value re-arms follow and DOM append
   * heuristics no longer do so. That distinction matters for transcripts:
   * loading or switching to a longer branch also appends anchored rows, but it
   * is not permission to move a reader. Use a signal stable across row re-keys.
   */
  followKey?: React.Key | null
  /** Where a transcript opens, applied once on the first non-empty render. */
  defaultScrollPosition?: DefaultScrollPosition
  /** Distance from an edge that still counts as being at it. */
  scrollEdgeThreshold?: number
  /** Margin applied to the aligned edge of a scroll target. */
  scrollMargin?: number
  /** How much of the previous turn stays visible above an anchored one. */
  scrollPreviousItemPeek?: number
}

function useScrollerState({
  autoScroll = false,
  defaultScrollPosition = 'end',
  followKey,
  scrollEdgeThreshold = DEFAULT_EDGE_THRESHOLD,
  scrollMargin = DEFAULT_SCROLL_MARGIN,
  scrollPreviousItemPeek = DEFAULT_PREVIOUS_ITEM_PEEK,
}: MessageScrollerProviderProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const spacerRef = React.useRef<HTMLDivElement | null>(null)

  const autoScrollRef = React.useRef(autoScroll)
  const edgeThresholdRef = React.useRef(scrollEdgeThreshold)
  const marginRef = React.useRef(scrollMargin)
  const peekRef = React.useRef(scrollPreviousItemPeek)
  React.useLayoutEffect(() => {
    autoScrollRef.current = autoScroll
    edgeThresholdRef.current = scrollEdgeThreshold
    marginRef.current = scrollMargin
    peekRef.current = scrollPreviousItemPeek
  }, [autoScroll, scrollEdgeThreshold, scrollMargin, scrollPreviousItemPeek])

  const modeRef = React.useRef<ScrollMode>(autoScroll ? 'follow' : 'idle')
  // `undefined` is also the uncontrolled sentinel. A non-null key on mount is
  // therefore a real instruction: opening a conversation whose answer is
  // already streaming should land on, and keep following, its live edge.
  const followKeyRef = React.useRef<React.Key | null | undefined>(undefined)
  const hasFollowKeyRef = React.useRef(followKey !== undefined)
  hasFollowKeyRef.current = followKey !== undefined
  const itemCountRef = React.useRef(0)
  const firstItemRef = React.useRef<HTMLElement | null>(null)
  const lastAnchorRef = React.useRef<HTMLElement | null>(null)
  const messageElementsRef = React.useRef(new Map<string, HTMLElement>())
  const trackedMessagesRef = React.useRef(new Set<string>())
  const visibleMessageIdsRef = React.useRef(new Set<string>())
  const pendingMessageRef = React.useRef<{ messageId: string; options?: ScrollCommandOptions } | null>(null)
  const pendingHandledBeforeContentRef = React.useRef(false)
  const prependRestoreRef = React.useRef<{ element: HTMLElement; viewportTop: number } | null>(null)
  const preserveScrollOnPrependRef = React.useRef(true)
  const defaultAppliedRef = React.useRef(false)
  const lastScrollTopRef = React.useRef(0)
  const spacerHeightRef = React.useRef(0)
  const spacerGapRef = React.useRef<number | null>(null)
  const autoscrollingRef = React.useRef(false)
  const autoscrollingTimerRef = React.useRef<number | null>(null)
  /** Where the in-flight programmatic scroll is headed, so the scroll event
   *  that lands on it can hand control back. */
  const programmaticTargetRef = React.useRef<number | null>(null)
  const stateFrameRef = React.useRef<number | null>(null)
  const visibilityFrameRef = React.useRef<number | null>(null)
  const resizeFrameRef = React.useRef<number | null>(null)
  const observerRef = React.useRef<IntersectionObserver | null>(null)

  const stateStoreRef = React.useRef<Store<ScrollableState> | null>(null)
  if (stateStoreRef.current === null) stateStoreRef.current = createStore(NO_SCROLLABLE, sameScrollable)
  const stateStore = stateStoreRef.current

  const visibilityStoreRef = React.useRef<Store<VisibilityState> | null>(null)
  if (visibilityStoreRef.current === null) visibilityStoreRef.current = createStore(NO_VISIBILITY, sameVisibility)
  const visibilityStore = visibilityStoreRef.current

  // A default position the caller changes is a new instruction, not a re-run.
  const defaultPositionRef = React.useRef(defaultScrollPosition)
  React.useLayoutEffect(() => {
    if (defaultPositionRef.current === defaultScrollPosition) return
    defaultPositionRef.current = defaultScrollPosition
    defaultAppliedRef.current = false
  }, [defaultScrollPosition])

  /* -- primitives ------------------------------------------------------- */

  const setSpacerHeight = React.useCallback((height: number) => {
    const spacer = spacerRef.current
    if (!spacer) return
    const next = Math.max(0, Math.ceil(height))
    if (spacerHeightRef.current === next) return
    spacerHeightRef.current = next
    if (spacerGapRef.current === null) spacerGapRef.current = rowGapOf(spacer.parentElement)
    spacer.hidden = next === 0
    spacer.style.height = `${next}px`
    // The spacer is a flex child like any row, so showing it also introduces one
    // more gap; the negative margin takes that gap back.
    spacer.style.marginTop = next > 0 ? `${-spacerGapRef.current}px` : ''
  }, [])

  const writeStateAttributes = React.useCallback((state: ScrollableState) => {
    const edges = [state.start && 'start', state.end && 'end'].filter(Boolean).join(' ')
    for (const el of [rootRef.current, viewportRef.current]) {
      if (!el) continue
      if (edges) el.setAttribute('data-scrollable', edges)
      else el.removeAttribute('data-scrollable')
      el.toggleAttribute('data-autoscrolling', autoscrollingRef.current)
      // Mirrored so the policy is inspectable from the DOM. Whether the
      // viewport is chasing the stream or holding still for the reader is the
      // first thing worth knowing when the scroll behaviour looks wrong.
      el.setAttribute('data-scroll-mode', modeRef.current)
    }
  }, [])

  /** Reads the viewport and publishes `data-scrollable` / the scrollable store. */
  const commitScrollState = React.useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    let state = NO_SCROLLABLE
    if (viewport && content) {
      // Measured against the rows rather than `scrollHeight`: the spacer is
      // empty room held open for the current turn, and offering to scroll the
      // reader down into it is offering to scroll them into nothing.
      const extent = contentExtent(content, spacerRef.current, viewport)
      state = {
        start: viewport.scrollTop > edgeThresholdRef.current,
        end: extent - viewport.scrollTop - viewport.clientHeight > edgeThresholdRef.current,
      }
    }
    // While following, the reader is at the live edge by definition; reporting
    // otherwise would flash the "jump to latest" button on every chunk.
    const published = modeRef.current === 'follow' ? { ...state, end: false } : state
    writeStateAttributes(published)
    stateStore.setSnapshot(published)
  }, [stateStore, writeStateAttributes])

  const scheduleStateCommit = React.useCallback(() => {
    if (stateFrameRef.current !== null) return
    stateFrameRef.current = window.requestAnimationFrame(() => {
      stateFrameRef.current = null
      commitScrollState()
    })
  }, [commitScrollState])

  const markAutoscrolling = React.useCallback(
    (active: boolean) => {
      if (autoscrollingTimerRef.current !== null) {
        window.clearTimeout(autoscrollingTimerRef.current)
        autoscrollingTimerRef.current = null
      }
      autoscrollingRef.current = active
      if (!active) {
        programmaticTargetRef.current = null
        return
      }
      autoscrollingTimerRef.current = window.setTimeout(() => {
        autoscrollingTimerRef.current = null
        autoscrollingRef.current = false
        programmaticTargetRef.current = null
        commitScrollState()
      }, AUTOSCROLL_TIMEOUT_MS)
    },
    [commitScrollState],
  )

  const syncVisibility = React.useCallback(() => {
    if (!visibilityStore.hasListeners() || visibilityFrameRef.current !== null) return
    visibilityFrameRef.current = window.requestAnimationFrame(() => {
      visibilityFrameRef.current = null
      if (!visibilityStore.hasListeners()) return
      const content = contentRef.current
      const viewport = viewportRef.current
      if (!content || !viewport) return
      const bounds = viewport.getBoundingClientRect()
      const readingLine = bounds.top + marginRef.current + peekRef.current
      const withoutObserver = typeof IntersectionObserver === 'undefined'
      const visible: string[] = []
      let currentAnchorId: string | null = null
      for (const item of itemsOf(content, spacerRef.current)) {
        const id = item.dataset.messageId
        if (!id) continue
        const isAnchor = item.dataset.scrollAnchor === 'true'
        const rect = isAnchor || withoutObserver ? item.getBoundingClientRect() : null
        const onScreen =
          withoutObserver && rect
            ? rect.bottom > readingLine && rect.top < bounds.bottom
            : visibleMessageIdsRef.current.has(id)
        if (onScreen) visible.push(id)
        if (isAnchor && rect && rect.top <= readingLine + EPSILON) currentAnchorId = id
      }
      visibilityStore.setSnapshot(
        visible.length === 0 && currentAnchorId === null
          ? NO_VISIBILITY
          : { currentAnchorId, visibleMessageIds: visible },
      )
    })
  }, [visibilityStore])

  /* -- the policy ------------------------------------------------------- */

  /**
   * The spacer height that lets the last anchored turn sit at the top edge.
   *
   * This is what makes anchoring a consequence of following rather than a mode
   * of its own: while the answer is short the spacer makes "the end" and "the
   * question at the top" the same scroll position, and it melts away by exactly
   * as much as the answer grows.
   */
  const desiredSpacer = React.useCallback((): number => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport) return 0
    const items = itemsOf(content, spacerRef.current)
    const anchor = lastAnchorOf(items)
    if (!anchor) return 0
    const padding = blockPadding(content)
    const target = offsetTopIn(anchor, viewport) - padding.start - marginRef.current - peekRef.current
    const extent = contentExtent(content, spacerRef.current, viewport)
    return Math.max(0, target + viewport.clientHeight - extent)
  }, [])

  const scrollViewportTo = React.useCallback(
    (top: number, behavior: ScrollBehavior = 'auto') => {
      const viewport = viewportRef.current
      if (!viewport) return
      // Clamped rather than left to the browser so the target is always a
      // position the viewport can actually reach, which is what lets the scroll
      // event recognise the landing.
      const next = Math.min(Math.max(0, top), Math.max(0, viewport.scrollHeight - viewport.clientHeight))
      if (Math.abs(viewport.scrollTop - next) <= EPSILON) {
        commitScrollState()
        return
      }
      programmaticTargetRef.current = next
      markAutoscrolling(true)
      viewport.scrollTo({ top: next, behavior })
      // `lastScrollTop` is deliberately left to the scroll event. Writing the
      // target here would make a smooth scroll look like it was travelling
      // backwards on its way there, and reading the transcript as the reader
      // taking over.
      scheduleStateCommit()
    },
    [commitScrollState, markAutoscrolling, scheduleStateCommit],
  )

  /**
   * Re-solve the spacer and, while following, re-stick to the live edge.
   *
   * Called for every height change in the transcript, which during a stream is
   * every frame that lands a chunk.
   */
  const reconcile = React.useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const viewport = viewportRef.current
      const content = contentRef.current
      if (!viewport || !content) return
      const wanted = desiredSpacer()
      if (modeRef.current === 'follow') {
        setSpacerHeight(wanted)
        scrollViewportTo(Math.max(0, viewport.scrollHeight - viewport.clientHeight), behavior)
      } else {
        // Shrinking the spacer past the reader's own position would have the
        // browser clamp the scroll offset, which reads as the page lurching.
        const keep = viewport.scrollTop + viewport.clientHeight - contentExtent(content, spacerRef.current, viewport)
        setSpacerHeight(Math.max(wanted, keep))
        commitScrollState()
      }
      syncVisibility()
    },
    [commitScrollState, desiredSpacer, scrollViewportTo, setSpacerHeight, syncVisibility],
  )

  const enterFollow = React.useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      modeRef.current = 'follow'
      reconcile(behavior)
    },
    [reconcile],
  )

  /** Scroll so `element` sits at `align` within the viewport. */
  const scrollToElement = React.useCallback(
    (
      element: HTMLElement,
      {
        align = 'start',
        behavior = 'auto',
        scrollMargin: margin = marginRef.current,
        onlyWhenAbove = false,
      }: ScrollCommandOptions = {},
    ): boolean => {
      const viewport = viewportRef.current
      const content = contentRef.current
      if (!viewport || !content || !content.contains(element)) return false

      const top = relativeTop(element, viewport)
      const padding = blockPadding(content)
      if (onlyWhenAbove && top >= padding.start + margin - EPSILON) return false

      const offset = offsetTopIn(element, viewport)
      const height = element.getBoundingClientRect().height
      let target: number
      if (align === 'center') {
        const room = Math.max(0, viewport.clientHeight - padding.start - padding.end)
        target = offset - padding.start - (room - height) / 2 - margin
      } else if (align === 'end') {
        target = offset - viewport.clientHeight + height + padding.end + margin
      } else if (align === 'nearest') {
        const bottom = offset + height
        const top_ = viewport.scrollTop + padding.start
        const limit = viewport.scrollTop + viewport.clientHeight - padding.end
        if (offset >= top_ && bottom <= limit) return true
        target = offset < top_ ? offset - padding.start - margin : bottom - viewport.clientHeight + padding.end + margin
      } else {
        target = offset - padding.start - margin
      }

      // Reaching the target may need more room below the transcript than the
      // resting spacer provides.
      const extent = contentExtent(content, spacerRef.current, viewport)
      setSpacerHeight(Math.max(desiredSpacer(), target + viewport.clientHeight - extent))

      modeRef.current = 'idle'
      scrollViewportTo(target, behavior)
      syncVisibility()
      return true
    },
    [desiredSpacer, scrollViewportTo, setSpacerHeight, syncVisibility],
  )

  const scrollToEnd = React.useCallback(
    ({ behavior = 'auto' }: ScrollCommandOptions = {}): boolean => {
      const viewport = viewportRef.current
      if (!viewport) return false
      // Returning to the live edge re-arms following, which is what makes the
      // "jump to latest" button mean "and keep up from here".
      modeRef.current = autoScrollRef.current ? 'follow' : 'idle'
      setSpacerHeight(desiredSpacer())
      scrollViewportTo(Math.max(0, viewport.scrollHeight - viewport.clientHeight), behavior)
      syncVisibility()
      return true
    },
    [desiredSpacer, scrollViewportTo, setSpacerHeight, syncVisibility],
  )

  const scrollToStart = React.useCallback(
    ({ behavior = 'auto' }: ScrollCommandOptions = {}): boolean => {
      if (!viewportRef.current) return false
      modeRef.current = 'idle'
      setSpacerHeight(desiredSpacer())
      scrollViewportTo(0, behavior)
      syncVisibility()
      return true
    },
    [desiredSpacer, scrollViewportTo, setSpacerHeight, syncVisibility],
  )

  const scrollToMessage = React.useCallback(
    (messageId: string, options?: ScrollCommandOptions): boolean => {
      const element = messageElementsRef.current.get(messageId)
      if (element) {
        defaultAppliedRef.current = true
        pendingMessageRef.current = null
        // False here means the command was considered and declined — an
        // `onlyWhenAbove` target that is already in view — not that it was lost.
        return scrollToElement(element, options)
      }
      // A command can resolve while the transcript still only contains an empty
      // state or another unaddressable decoration. Direct-child count is not a
      // useful test here: those nodes are rows for layout, but there is no
      // message a command could have meant yet.
      if (trackedMessagesRef.current.size === 0) {
        pendingMessageRef.current = { messageId, options }
        defaultAppliedRef.current = true
        return true
      }
      return false
    },
    [scrollToElement],
  )

  const flushPendingMessage = React.useCallback(
    (beforeContentChange = false): boolean => {
      const pending = pendingMessageRef.current
      if (!pending) return false
      const element = messageElementsRef.current.get(pending.messageId)
      const content = contentRef.current
      const viewport = viewportRef.current
      if (!element || !content || !viewport || !content.contains(element)) return false

      // Consume the command even when `onlyWhenAbove` declines to move. Keeping
      // it pending would turn a one-shot request into a trap: a later reflow could
      // move the target above the reading line and unexpectedly fire it then.
      pendingMessageRef.current = null
      defaultAppliedRef.current = true
      pendingHandledBeforeContentRef.current = beforeContentChange
      if (!scrollToElement(element, pending.options)) {
        commitScrollState()
        syncVisibility()
      }
      return true
    },
    [commitScrollState, scrollToElement, syncVisibility],
  )

  const applyDefaultPosition = React.useCallback((): boolean => {
    if (defaultAppliedRef.current || itemCountRef.current === 0) return false
    const position = defaultPositionRef.current
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport) return false

    if (position === 'start') {
      scrollToStart({ behavior: 'auto' })
    } else if (position === 'last-anchor') {
      const anchor = lastAnchorOf(itemsOf(content, spacerRef.current))
      // With no anchor, or a last turn that already fits, the end *is* the
      // last anchor.
      const fits = anchor
        ? contentExtent(content, spacerRef.current, viewport) - offsetTopIn(anchor, viewport) <= viewport.clientHeight
        : true
      if (!anchor || fits) scrollToEnd({ behavior: 'auto' })
      else scrollToElement(anchor, { align: 'start', scrollMargin: marginRef.current + peekRef.current })
    } else {
      scrollToEnd({ behavior: 'auto' })
    }
    defaultAppliedRef.current = true
    return true
  }, [scrollToElement, scrollToEnd, scrollToStart])

  const rememberPrependAnchor = React.useCallback(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport) {
      prependRestoreRef.current = null
      return
    }
    const item = firstVisibleItem(content, spacerRef.current, viewport)
    prependRestoreRef.current = item ? { element: item, viewportTop: relativeTop(item, viewport) } : null
  }, [])

  const restorePrepend = React.useCallback((): boolean => {
    const restore = prependRestoreRef.current
    const viewport = viewportRef.current
    if (!restore || !viewport || !restore.element.isConnected) return false
    const drift = relativeTop(restore.element, viewport) - restore.viewportTop
    if (Math.abs(drift) <= EPSILON) return false
    viewport.scrollTop += drift
    restore.viewportTop = relativeTop(restore.element, viewport)
    scheduleStateCommit()
    syncVisibility()
    return true
  }, [scheduleStateCommit, syncVisibility])

  /* -- lifecycle -------------------------------------------------------- */

  const applyContentChange = React.useCallback(
    (
      items: HTMLElement[],
      previousCount: number,
      previousFirst: HTMLElement | null,
      previousLastAnchor: HTMLElement | null,
      nextLastAnchor: HTMLElement | null,
    ) => {
      // Refs attach before the content observer runs. If registering the target
      // already executed a queued command, this mutation is the same update and
      // must not immediately override it as a newly appended turn.
      if (pendingHandledBeforeContentRef.current) {
        pendingHandledBeforeContentRef.current = false
        commitScrollState()
        syncVisibility()
        return
      }
      if (flushPendingMessage()) return
      // If the first real batch mounted without the queued target, it is not in
      // this transcript. Drop the stale command and honour the normal opening
      // position instead of leaving the conversation at scrollTop=0 forever.
      if (pendingMessageRef.current && trackedMessagesRef.current.size > 0) {
        pendingMessageRef.current = null
        defaultAppliedRef.current = false
        if (applyDefaultPosition()) return
      }
      if (previousCount === 0) {
        if (applyDefaultPosition()) return
        commitScrollState()
        syncVisibility()
        return
      }
      const previousIndex = previousFirst ? items.indexOf(previousFirst) : -1
      const previousAnchorIndex = previousLastAnchor ? items.indexOf(previousLastAnchor) : -1
      const nextAnchorIndex = nextLastAnchor ? items.indexOf(nextLastAnchor) : -1
      // A new turn is the one event that overrides the reader: it exists because
      // they just sent something. Compare surviving anchor elements rather than
      // child counts: the turn is inserted before trailing status rows, and it
      // may replace an empty/error row without changing the count at all. A
      // reload re-key does not qualify because its old anchor is disconnected.
      const appendedAnchor =
        !hasFollowKeyRef.current &&
        nextLastAnchor !== null &&
        nextLastAnchor !== previousLastAnchor &&
        (previousLastAnchor ? previousAnchorIndex >= 0 && nextAnchorIndex > previousAnchorIndex : previousIndex <= 0)
      if (appendedAnchor) {
        enterFollow()
        return
      }
      // Older rows arriving above the transcript must not move what is on screen.
      if (preserveScrollOnPrependRef.current && previousIndex > 0) {
        restorePrepend()
        return
      }
      // Everything else — a row re-keyed by a reload, a branch swap, an error
      // appearing — leaves the viewport where the reader put it. Upstream
      // re-anchored here, which is what jumped to the top of the conversation
      // when the optimistic user row was swapped for the persisted one.
      reconcile()
    },
    [
      applyDefaultPosition,
      commitScrollState,
      enterFollow,
      flushPendingMessage,
      reconcile,
      restorePrepend,
      syncVisibility,
    ],
  )

  const handleContentChange = React.useCallback(() => {
    const content = contentRef.current
    if (!content) return
    const items = itemsOf(content, spacerRef.current)
    const previousCount = itemCountRef.current
    const previousFirst = firstItemRef.current
    const previousLastAnchor = lastAnchorRef.current
    const nextLastAnchor = lastAnchorOf(items)
    itemCountRef.current = items.length
    firstItemRef.current = items[0] ?? null
    lastAnchorRef.current = nextLastAnchor

    applyContentChange(items, previousCount, previousFirst, previousLastAnchor, nextLastAnchor)
    rememberPrependAnchor()
  }, [applyContentChange, rememberPrependAnchor])

  const handleResize = React.useCallback(() => {
    if (resizeFrameRef.current !== null) return
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      reconcile()
    })
  }, [reconcile])

  const syncAfterScroll = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const top = viewport.scrollTop
    const movedUp = top < lastScrollTopRef.current - EPSILON
    lastScrollTopRef.current = top

    // A programmatic scroll owns the viewport until it lands. Handing control
    // back on a timer instead would let a long smooth scroll be read as the
    // reader arriving at the live edge, and following would drag it back.
    const target = programmaticTargetRef.current
    if (target !== null && Math.abs(top - target) <= 1) markAutoscrolling(false)

    if (!autoscrollingRef.current) {
      const threshold = edgeThresholdRef.current
      // Two different questions, and following needs both answered yes.
      //
      // `atEnd` asks whether the viewport is as far down as it can go. Direction
      // of travel alone cannot: a row collapsing or a marker being replaced by
      // an answer shortens the transcript, the browser clamps the offset
      // downward, and that is indistinguishable from the reader scrolling up —
      // it cost following its place on every turn that finished.
      //
      // `readEverything` asks whether there is any transcript left below, as
      // opposed to spacer. A command that parks an answer at the top edge holds
      // the spacer open beneath it, so the viewport is at its end there without
      // the reader having read a word of what is under it.
      const atEnd = Math.max(0, viewport.scrollHeight - viewport.clientHeight) - top <= threshold
      const remaining = contentRef.current
        ? contentExtent(contentRef.current, spacerRef.current, viewport) - top - viewport.clientHeight
        : 0
      if (movedUp && !atEnd) {
        // Dragging the scrollbar produces no wheel or key event, so this is the
        // only signal that it happened.
        modeRef.current = 'idle'
      } else if (autoScrollRef.current && atEnd && remaining <= threshold) {
        modeRef.current = 'follow'
      }
    }

    commitScrollState()
    syncVisibility()
    rememberPrependAnchor()
  }, [commitScrollState, markAutoscrolling, rememberPrependAnchor, syncVisibility])

  /** Wheel, touch and the scrolling keys: the reader is driving now. */
  const userScrollIntent = React.useCallback(() => {
    if (autoscrollingRef.current) markAutoscrolling(false)
    modeRef.current = 'idle'
  }, [markAutoscrolling])

  const isFollowing = React.useCallback(() => modeRef.current === 'follow', [])

  /* -- visibility ------------------------------------------------------- */

  const observeVisibility = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || !visibilityStore.hasListeners()) return
    if (typeof IntersectionObserver === 'undefined') {
      syncVisibility()
      return
    }
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.messageId
            if (!id) continue
            if (entry.isIntersecting) visibleMessageIdsRef.current.add(id)
            else visibleMessageIdsRef.current.delete(id)
          }
          syncVisibility()
        },
        {
          root: viewport,
          rootMargin: `${-(marginRef.current + peekRef.current)}px 0px 0px 0px`,
          threshold: [0, 0.01, 0.5, 1],
        },
      )
    }
    for (const id of trackedMessagesRef.current) {
      const el = messageElementsRef.current.get(id)
      if (el) observerRef.current.observe(el)
    }
    syncVisibility()
  }, [syncVisibility, visibilityStore])

  const unobserveVisibility = React.useCallback(() => {
    if (visibilityFrameRef.current !== null) {
      window.cancelAnimationFrame(visibilityFrameRef.current)
      visibilityFrameRef.current = null
    }
    observerRef.current?.disconnect()
    observerRef.current = null
    visibleMessageIdsRef.current.clear()
    visibilityStore.setSnapshot(NO_VISIBILITY)
  }, [visibilityStore])

  const registerMessage = React.useCallback<RegisterMessage>(
    (messageId, element, previous, track) => {
      if (element) {
        messageElementsRef.current.set(messageId, element)
        if (track) {
          trackedMessagesRef.current.add(messageId)
          observerRef.current?.observe(element)
          syncVisibility()
        }
        if (pendingMessageRef.current?.messageId === messageId) flushPendingMessage(true)
        return
      }
      if (previous && messageElementsRef.current.get(messageId) === previous) {
        messageElementsRef.current.delete(messageId)
        trackedMessagesRef.current.delete(messageId)
        visibleMessageIdsRef.current.delete(messageId)
        observerRef.current?.unobserve(previous)
        if (track) syncVisibility()
      }
    },
    [flushPendingMessage, syncVisibility],
  )

  /* -- wiring ----------------------------------------------------------- */

  const setRootElement = React.useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el
      if (el) writeStateAttributes(stateStore.getSnapshot())
    },
    [stateStore, writeStateAttributes],
  )

  const setViewportElement = React.useCallback(
    (el: HTMLDivElement | null) => {
      viewportRef.current = el
      if (el) writeStateAttributes(stateStore.getSnapshot())
    },
    [stateStore, writeStateAttributes],
  )

  const setContentElement = React.useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el
  }, [])

  const setSpacerElement = React.useCallback((el: HTMLDivElement | null) => {
    spacerRef.current = el
    spacerGapRef.current = null
  }, [])

  React.useLayoutEffect(() => {
    applyDefaultPosition()
  }, [applyDefaultPosition])

  React.useLayoutEffect(() => {
    if (Object.is(followKeyRef.current, followKey)) return
    followKeyRef.current = followKey
    if (followKey != null && autoScrollRef.current) enterFollow()
  }, [enterFollow, followKey])

  React.useLayoutEffect(() => {
    if (autoScroll && modeRef.current === 'follow' && itemCountRef.current > 0) reconcile()
    else commitScrollState()
  }, [autoScroll, commitScrollState, reconcile])

  React.useEffect(
    () => () => {
      for (const frame of [stateFrameRef, visibilityFrameRef, resizeFrameRef]) {
        if (frame.current !== null) window.cancelAnimationFrame(frame.current)
        frame.current = null
      }
      if (autoscrollingTimerRef.current !== null) window.clearTimeout(autoscrollingTimerRef.current)
      observerRef.current?.disconnect()
      observerRef.current = null
    },
    [],
  )

  const context = React.useMemo<ScrollerContextValue>(
    () => ({
      setRootElement,
      setViewportElement,
      setContentElement,
      setSpacerElement,
      viewportRef,
      preserveScrollOnPrependRef,
      handleContentChange,
      handleResize,
      syncAfterScroll,
      userScrollIntent,
      scrollToEnd,
      scrollToStart,
      scrollToMessage,
      isFollowing,
      stateStore,
      visibilityStore,
      observeVisibility,
      unobserveVisibility,
    }),
    [
      handleContentChange,
      handleResize,
      isFollowing,
      observeVisibility,
      scrollToEnd,
      scrollToMessage,
      scrollToStart,
      setContentElement,
      setRootElement,
      setSpacerElement,
      setViewportElement,
      stateStore,
      syncAfterScroll,
      unobserveVisibility,
      userScrollIntent,
      visibilityStore,
    ],
  )

  return { context, registerMessage }
}

/* ------------------------------------------------------------------ parts */

function Provider({ children, ...props }: MessageScrollerProviderProps) {
  const { context, registerMessage } = useScrollerState(props)
  return (
    <ScrollerContext.Provider value={context}>
      <RegisterContext.Provider value={registerMessage}>{children}</RegisterContext.Provider>
    </ScrollerContext.Provider>
  )
}

function Root({ children, ...props }: React.ComponentProps<'div'>) {
  const { setRootElement } = useScrollerContext()
  return (
    <div ref={setRootElement} {...props}>
      {children}
    </div>
  )
}

interface ViewportProps extends React.ComponentProps<'div'> {
  preserveScrollOnPrepend?: boolean
}

function Viewport({
  children,
  onKeyDown,
  onScroll,
  onTouchCancel,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  onWheel,
  preserveScrollOnPrepend = true,
  ref,
  role,
  tabIndex,
  'aria-label': ariaLabel,
  ...props
}: ViewportProps) {
  const {
    handleResize,
    preserveScrollOnPrependRef,
    setViewportElement,
    syncAfterScroll,
    userScrollIntent,
    viewportRef,
  } = useScrollerContext()
  preserveScrollOnPrependRef.current = preserveScrollOnPrepend
  const touchYRef = React.useRef<number | null>(null)

  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      setViewportElement(el)
      mergeRefs(ref)?.(el)
    },
    [ref, setViewportElement],
  )

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(handleResize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [handleResize, viewportRef])

  return (
    <div
      ref={setRef}
      role={role ?? 'region'}
      aria-label={ariaLabel ?? 'Messages'}
      tabIndex={tabIndex ?? 0}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        const target = event.target
        const interactive =
          target instanceof Element &&
          target !== event.currentTarget &&
          target.closest(
            'a[href], button, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="checkbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="radio"], [role="slider"], [role="spinbutton"], [role="switch"], [role="tab"], [role="textbox"]',
          ) !== null
        if (!interactive && (SCROLL_AWAY_KEYS.has(event.key) || (event.key === ' ' && event.shiftKey))) {
          userScrollIntent()
        }
      }}
      onScroll={(event) => {
        syncAfterScroll()
        onScroll?.(event)
      }}
      onTouchCancel={(event) => {
        touchYRef.current = null
        onTouchCancel?.(event)
      }}
      onTouchEnd={(event) => {
        touchYRef.current = null
        onTouchEnd?.(event)
      }}
      onTouchMove={(event) => {
        onTouchMove?.(event)
        if (event.defaultPrevented) return
        const nextY = event.touches[0]?.clientY ?? null
        const previousY = touchYRef.current
        touchYRef.current = nextY
        // A finger moving down moves the transcript away from its live edge.
        // The opposite gesture is an attempt to reach the edge and must not
        // disarm follow when the viewport is already there.
        if (nextY !== null && previousY !== null && nextY > previousY + EPSILON) userScrollIntent()
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event)
        if (event.defaultPrevented) return
        touchYRef.current = event.touches[0]?.clientY ?? null
      }}
      onWheel={(event) => {
        onWheel?.(event)
        // Downward overscroll at the live edge emits no scroll event. Treating
        // every wheel gesture as a departure leaves the next streamed chunk
        // frozen for someone who was explicitly trying to stay at the bottom.
        if (!event.defaultPrevented && !event.ctrlKey && event.deltaY < -EPSILON) userScrollIntent()
      }}
      {...props}
    >
      {children}
    </div>
  )
}

interface ContentProps extends React.ComponentProps<'div'> {
  spacerClassName?: string
}

function Content({ children, ref, role, spacerClassName, 'aria-relevant': ariaRelevant, ...props }: ContentProps) {
  const { handleContentChange, handleResize, setContentElement, setSpacerElement } = useScrollerContext()
  const localRef = React.useRef<HTMLDivElement | null>(null)

  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      localRef.current = el
      setContentElement(el)
      mergeRefs(ref)?.(el)
    },
    [ref, setContentElement],
  )

  React.useLayoutEffect(() => {
    const content = localRef.current
    if (!content) return
    handleContentChange()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(handleContentChange)
    observer.observe(content, { childList: true })
    return () => observer.disconnect()
  }, [handleContentChange])

  React.useEffect(() => {
    const content = localRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(handleResize)
    observer.observe(content)
    return () => observer.disconnect()
  }, [handleResize])

  return (
    <div ref={setRef} role={role ?? 'log'} aria-relevant={ariaRelevant ?? 'additions'} {...props}>
      {children}
      <div
        ref={setSpacerElement}
        aria-hidden="true"
        data-message-scroller-spacer=""
        hidden
        className={spacerClassName}
      />
    </div>
  )
}

export interface MessageScrollerItemProps extends React.ComponentProps<'div'> {
  messageId?: string
  scrollAnchor?: boolean
}

function Item({ messageId, ref, scrollAnchor = false, ...props }: MessageScrollerItemProps) {
  const register = React.useContext(RegisterContext)
  const previousRef = React.useRef<HTMLDivElement | null>(null)

  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      const previous = previousRef.current
      previousRef.current = el
      if (messageId && register) register(messageId, el, previous, true)
      mergeRefs(ref)?.(el)
    },
    [messageId, ref, register],
  )

  return (
    <div ref={setRef} data-message-id={messageId} data-scroll-anchor={scrollAnchor ? 'true' : 'false'} {...props} />
  )
}

export interface MessageScrollerAnchorProps extends React.ComponentProps<'div'> {
  messageId: string
}

/**
 * An addressable point *inside* a row.
 *
 * A turn is one item so that collapsing its middle cannot move its own top, but
 * "take me back to the top of the answer" needs to name something finer than
 * the turn. This registers under the same ids `scrollToMessage` resolves,
 * without becoming a row of its own — it is not a direct child of the content,
 * so nothing that walks the transcript sees it.
 *
 * Renders a plain div outside a provider, so a row stays previewable on its own.
 */
function Anchor({ messageId, ref, ...props }: MessageScrollerAnchorProps) {
  const register = React.useContext(RegisterContext)
  const previousRef = React.useRef<HTMLDivElement | null>(null)

  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      const previous = previousRef.current
      previousRef.current = el
      if (register) register(messageId, el, previous, false)
      mergeRefs(ref)?.(el)
    },
    [messageId, ref, register],
  )

  return <div ref={setRef} data-message-anchor={messageId} {...props} />
}

export interface MessageScrollerButtonProps extends React.ComponentProps<typeof dom.button> {
  behavior?: ScrollBehavior
  direction?: 'start' | 'end'
}

function Button({
  behavior = 'smooth',
  children,
  direction = 'end',
  onClick,
  render,
  tabIndex,
  type = 'button',
  ...props
}: MessageScrollerButtonProps) {
  const { scrollToEnd, scrollToStart, stateStore } = useScrollerContext()
  const onClickRef = React.useRef(onClick)
  React.useLayoutEffect(() => {
    onClickRef.current = onClick
  }, [onClick])

  const active = React.useSyncExternalStore(
    React.useCallback((listener) => stateStore.subscribe(listener), [stateStore]),
    React.useCallback(
      () => (direction === 'start' ? stateStore.getSnapshot().start : stateStore.getSnapshot().end),
      [direction, stateStore],
    ),
    React.useCallback(
      () => (direction === 'start' ? stateStore.getSnapshot().start : stateStore.getSnapshot().end),
      [direction, stateStore],
    ),
  )

  return (
    <dom.button
      data-active={active ? 'true' : 'false'}
      data-direction={String(direction)}
      type={type}
      // Nothing to scroll toward means nothing to focus either, so an
      // inactive control does not become an extra tab stop.
      inert={!active}
      tabIndex={active ? tabIndex : -1}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        if (!active) return
        onClickRef.current?.(event)
        if (event.defaultPrevented) return
        event.currentTarget.blur()
        if (direction === 'start') scrollToStart({ behavior })
        else scrollToEnd({ behavior })
      }}
      render={render}
      {...props}
    >
      {children ?? <span>Scroll to {direction}</span>}
    </dom.button>
  )
}

/* ------------------------------------------------------------------ hooks */

export function useMessageScroller() {
  const { isFollowing, scrollToEnd, scrollToMessage, scrollToStart } = useScrollerContext()
  return React.useMemo(
    () => ({ isFollowing, scrollToEnd, scrollToMessage, scrollToStart }),
    [isFollowing, scrollToEnd, scrollToMessage, scrollToStart],
  )
}

export function useMessageScrollerScrollable(): ScrollableState {
  const { stateStore } = useScrollerContext()
  return React.useSyncExternalStore(stateStore.subscribe, stateStore.getSnapshot, stateStore.getSnapshot)
}

export function useMessageScrollerVisibility(): VisibilityState {
  const { observeVisibility, unobserveVisibility, visibilityStore } = useScrollerContext()
  const subscribe = React.useCallback(
    (listener: () => void) => visibilityStore.subscribe(listener, observeVisibility, unobserveVisibility),
    [observeVisibility, unobserveVisibility, visibilityStore],
  )
  return React.useSyncExternalStore(subscribe, visibilityStore.getSnapshot, visibilityStore.getSnapshot)
}

export const MessageScroller = { Provider, Root, Viewport, Content, Item, Anchor, Button }
