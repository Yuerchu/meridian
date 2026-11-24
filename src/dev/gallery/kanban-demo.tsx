import { useState } from 'react'
import {
  Kanban,
  KanbanCard,
  KanbanColumn,
  type KanbanColumnData,
  type KanbanItem,
} from '@/components/yuerchu-ui/components/kanban/kanban'

const INITIAL: KanbanColumnData<KanbanItem>[] = [
  {
    id: 'todo',
    heading: '待做',
    cards: [
      { id: 'c1', textValue: '补过期 token 的测试' },
      { id: 'c2', textValue: '列出三个路由' },
    ],
  },
  {
    id: 'doing',
    heading: '进行中',
    cards: [{ id: 'c3', textValue: '抽出 verify_token' }],
  },
  { id: 'done', heading: '已完成', cards: [] },
]

export function DraggableKanban() {
  const [columns, setColumns] = useState(INITIAL)

  return (
    <div className="max-w-2xl">
      <Kanban columns={columns} onMove={setColumns} aria-label="可拖拽看板">
        {(column) => (
          <KanbanColumn key={column.id} column={column} emptyState="拖到这里">
            {(card) => <KanbanCard key={card.id} card={card} />}
          </KanbanColumn>
        )}
      </Kanban>
    </div>
  )
}
