import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FloatingToc } from '@heroui-pro/react/floating-toc'

import { useMessageScroller } from '@/components/ui/message-scroller'
import { readAnswerHeadings, type AnswerHeading } from '@/lib/answer-headings'
import { cn } from '@/lib/utils'

/** Below this a table of contents is longer than what it indexes. */
const MIN_HEADINGS = 3

/** Where in the viewport a heading counts as "the one being read". */
const ACTIVE_LINE = 0.25

/**
 * A table of contents for the long answer currently on screen.
 *
 * Pinned to the right edge of the viewport rather than to the answer it
 * describes: the transcript is `max-w-4xl mx-auto`, so an answer has no gutter
 * of its own to hang anything in, and one that scrolled away with its own text
 * would be gone exactly when a long answer needs it most. What follows the
 * reader is the *contents*, which swap wholesale when another long answer takes
 * over the viewport.
 *
 * The headings themselves are read off the DOM rather than parsed out of the
 * markdown — `lib/answer-headings.ts` says why that is the way round it is.
 *
 * Everything is computed in one rAF-coalesced pass, off a scroll listener and a
 * mutation observer. An `IntersectionObserver` per heading would have to be torn
 * down and rebuilt on every streamed token, and still could not answer "which
 * turn owns the viewport" without the geometry this pass already has.
 */
export function AnswerToc({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { scrollToElement } = useMessageScroller()
  const hostRef = useRef<HTMLDivElement>(null)
  const [entries, setEntries] = useState<AnswerHeading[]>([])
  const [active, setActive] = useState(0)

  // Not state: the elements are only ever read inside an event handler, and
  // holding them in state as well would re-render the transcript's neighbour on
  // every scroll frame that changed nothing visible.
  const entriesRef = useRef<AnswerHeading[]>([])

  const measure = useCallback(() => {
    const viewport = hostRef.current?.closest('[data-slot="message-scroller"]')
      ?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')
    if (!viewport) return

    const box = viewport.getBoundingClientRect()
    const line = box.top + box.height * ACTIVE_LINE

    // The turn that owns the viewport: the last one to have started above the
    // active line. Reading the *last* rather than the intersecting one keeps a
    // short turn scrolled past from blanking the contents of the long answer
    // still filling the screen behind it.
    let owner: Element | null = null
    for (const turn of viewport.querySelectorAll('[data-slot="turn"]')) {
      if (turn.getBoundingClientRect().top <= line) owner = turn
    }

    const next = owner ? readAnswerHeadings(owner) : []
    const usable = next.length >= MIN_HEADINGS ? next : []

    const previous = entriesRef.current
    const changed = usable.length !== previous.length
      || usable.some((entry, i) => entry.text !== previous[i].text || entry.element !== previous[i].element)
    if (changed) {
      entriesRef.current = usable
      setEntries(usable)
    }

    let current = 0
    usable.forEach((entry, i) => {
      if (entry.element.getBoundingClientRect().top <= line) current = i
    })
    setActive(current)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    const root = host?.closest('[data-slot="message-scroller"]')
    const viewport = root?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')
    if (!viewport) return

    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    schedule()
    viewport.addEventListener('scroll', schedule, { passive: true })
    // Streaming appends into an existing block as often as it adds one, so
    // `characterData` is not optional: without it the last heading of an answer
    // would only appear once something else changed the tree.
    const mutations = new MutationObserver(schedule)
    mutations.observe(viewport, { childList: true, subtree: true, characterData: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(viewport)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      viewport.removeEventListener('scroll', schedule)
      mutations.disconnect()
      resize.disconnect()
    }
  }, [measure])

  return (
    // Always mounted, so the observers above have somewhere to hang; empty
    // until an answer on screen earns one. `lg` is where the transcript's own
    // width stops growing and a margin appears beside it — narrower than that
    // the bars would sit on top of the text.
    <div
      ref={hostRef}
      data-slot="answer-toc"
      className={cn(
        'pointer-events-none absolute end-2 top-1/2 z-10 hidden -translate-y-1/2 lg:block',
        className,
      )}
    >
      {entries.length > 0 && (
        <div className="pointer-events-auto">
          <FloatingToc placement="right">
            <FloatingToc.Trigger aria-label={t('chat.toc.title')}>
              {entries.map((entry, i) => (
                <FloatingToc.Bar key={i} active={i === active} level={entry.level} />
              ))}
            </FloatingToc.Trigger>
            <FloatingToc.Content>
              {entries.map((entry, i) => (
                <FloatingToc.Item
                  key={i}
                  active={i === active}
                  level={entry.level}
                  // Through the scroller, not `scrollIntoView`: it grows the
                  // spacer when the target needs room below it and drops out of
                  // follow mode, so a jump taken mid-stream is not undone by
                  // the next token.
                  onClick={() => scrollToElement(entry.element, { align: 'start', behavior: 'smooth' })}
                >
                  {entry.text}
                </FloatingToc.Item>
              ))}
            </FloatingToc.Content>
          </FloatingToc>
        </div>
      )}
    </div>
  )
}
