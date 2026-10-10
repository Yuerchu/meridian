// An open column's cards in lanes, as many as its width fits.
//
// Lanes rather than a grid because a grid row is as tall as its tallest card:
// opening one card pushed down every card in the rows below it, across the
// whole column. Here a card belongs to one lane and opening it moves only what
// is under it in that lane.
//
// Lanes are dealt by position (i % n), not to the shortest lane: shortest-lane
// would re-deal whenever a card changes height, which is exactly the movement
// under the pointer this exists to remove.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Kanban } from '@/components/base'

const GAP = 8

export function Masonry<T>({
  items,
  minLaneWidth,
  label,
  empty,
  render,
}: {
  items: T[]
  /** In px: a lane narrower than this is not opened. */
  minLaneWidth: number
  label: string
  empty: ReactNode
  render: (item: T) => ReactNode
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [lanes, setLanes] = useState(1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setLanes(Math.max(1, Math.floor((entry.contentRect.width + GAP) / (minLaneWidth + GAP))))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [minLaneWidth])

  const dealt = Array.from({ length: lanes }, () => [] as T[])
  items.forEach((item, i) => dealt[i % lanes].push(item))

  return (
    <div ref={ref} data-slot="board-masonry" className="flex items-start gap-2">
      {items.length === 0 ? (
        <div className="px-2 py-3 text-caption-1-medium text-text-secondary">{empty}</div>
      ) : (
        dealt.map((lane, i) => (
          <Kanban.CardList
            key={i}
            aria-label={lanes > 1 ? t('board.column.lane', { label, n: i + 1 }) : label}
            className="min-w-0 flex-1"
          >
            {lane.map(render)}
          </Kanban.CardList>
        ))
      )}
    </div>
  )
}
