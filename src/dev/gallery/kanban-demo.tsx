// Cards that move: the pattern a board follows on top of the base — one
// `useDragAndDrop` per column, a custom drag type so nothing else is accepted,
// and every drop reduced to "this card, that column, this index".
import { useState } from 'react'
import { useDragAndDrop, type DropItem, type Key } from 'react-aria-components'

import { Kanban } from '@/components/base'
import { dropIndex, moveKeys, type DropPosition } from '@/lib/kanban-dnd'

const DRAG_TYPE = 'meridian-gallery-card'

const INITIAL: Record<string, string[]> = {
  待做: ['补过期 token 的测试', '列出三个路由'],
  进行中: ['抽出 verify_token'],
  已完成: [],
}

async function idsOf(items: DropItem[]): Promise<string[]> {
  const texts = await Promise.all(items.map((item) => (item.kind === 'text' ? item.getText(DRAG_TYPE) : null)))
  return texts.filter((id): id is string => id !== null)
}

export function DraggableKanban() {
  const [columns, setColumns] = useState(INITIAL)

  const move = (ids: string[], to: string, target: Key | null, position: DropPosition) =>
    setColumns((prev) => {
      const index = dropIndex(prev[to], new Set<Key>(ids), target, position)
      if (index === null) return prev
      const next: Record<string, string[]> = {}
      for (const [title, cards] of Object.entries(prev)) next[title] = cards.filter((card) => !ids.includes(card))
      next[to] = moveKeys(next[to], ids, index)
      return next
    })

  return (
    <Kanban size="sm" aria-label="可拖拽看板" className="max-w-2xl">
      {Object.entries(columns).map(([title, cards]) => (
        <DraggableColumn key={title} title={title} cards={cards} move={move} />
      ))}
    </Kanban>
  )
}

function DraggableColumn({
  title,
  cards,
  move,
}: {
  title: string
  cards: string[]
  move: (ids: string[], to: string, target: Key | null, position: DropPosition) => void
}) {
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ [DRAG_TYPE]: String(key), 'text/plain': String(key) })),
    acceptedDragTypes: [DRAG_TYPE],
    getDropOperation: () => 'move',
    onReorder: (e) => move([...e.keys].map(String), title, e.target.key, e.target.dropPosition),
    onInsert: async (e) => move(await idsOf(e.items), title, e.target.key, e.target.dropPosition),
    onRootDrop: async (e) => move(await idsOf(e.items), title, null, 'on'),
    renderDropIndicator: (target) => <Kanban.DropIndicator target={target} />,
  })

  return (
    <Kanban.Column>
      <Kanban.ColumnHeader>
        <Kanban.ColumnTitle>{title}</Kanban.ColumnTitle>
        <Kanban.ColumnCount>{cards.length}</Kanban.ColumnCount>
      </Kanban.ColumnHeader>
      <Kanban.ColumnBody>
        <Kanban.CardList
          aria-label={title}
          dragAndDropHooks={dragAndDropHooks}
          renderEmptyState={() => '拖到这里'}
          className="min-h-16"
        >
          {cards.map((card) => (
            <Kanban.Card key={card} id={card} textValue={card} className="flex items-center gap-1.5 p-1.5">
              <Kanban.DragHandle aria-label={`移动「${card}」`} />
              <span className="text-caption-1-regular">{card}</span>
            </Kanban.Card>
          ))}
        </Kanban.CardList>
      </Kanban.ColumnBody>
    </Kanban.Column>
  )
}
