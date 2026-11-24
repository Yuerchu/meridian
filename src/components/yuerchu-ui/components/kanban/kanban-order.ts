export interface KanbanItem {
  /** 卡片的稳定标识，必须是非空字符串，且在整个看板内唯一。 */
  id: string;
  /** 卡片的文字名称，用于拖动提示、移动菜单和键盘导航。 */
  textValue: string;
}

export interface KanbanColumnData<T extends KanbanItem> {
  /** 列的稳定标识，必须是非空字符串，且在看板各列中唯一。 */
  id: string;
  /** 列标题，同时用作该列卡片列表的无障碍名称。 */
  heading: string;
  /** 按显示顺序排列的卡片。折叠列时保留原有卡片。 */
  cards: readonly T[];
}

export interface KanbanMove {
  /** 移动的卡片标识。 */
  cardId: string;
  /** 卡片原来所在列的标识。 */
  fromColumnId: string;
  /** 目标列的标识。在同一列内排序时与 fromColumnId 相同。 */
  toColumnId: string;
  /** 卡片在目标列中的最终索引，从 0 开始。同列排序时，按卡片移出原位后的顺序计算。 */
  index: number;
}

export interface Source { cardId: string; fromColumnId: string }
export type Landing = { position: "before" | "after"; key: string } | { position: "end" | "empty" };

export function validateColumns(columns: readonly KanbanColumnData<KanbanItem>[]) {
  const lanes = new Set<string>();
  const cards = new Set<string>();
  for (const column of columns) {
    if (!column.id.trim() || lanes.has(column.id)) {
      throw new Error(`Kanban needs unique non-empty column ids: ${column.id}`);
    }
    if (!column.heading.trim()) throw new Error(`Kanban column ${column.id} needs a heading`);
    lanes.add(column.id);
    for (const item of column.cards) {
      if (!item.id.trim() || cards.has(item.id)) throw new Error(`Kanban needs unique non-empty card ids: ${item.id}`);
      if (!item.textValue.trim()) throw new Error(`Kanban card ${item.id} needs a textValue`);
      cards.add(item.id);
    }
  }
}

/** 鼠标、键盘和菜单共用：先移除再解析锚点，不把失效的锚点误当作“放末尾”。 */
export function proposeMove<T extends KanbanItem>(
  columns: readonly KanbanColumnData<T>[], source: Source, toColumnId: string, landing: Landing,
): { columns: KanbanColumnData<T>[]; move: KanbanMove } | null {
  const from = columns.find((c) => c.id === source.fromColumnId);
  const to = columns.find((c) => c.id === toColumnId);
  if (!from || !to || (landing.position === "empty" && to.cards.length !== 0)) return null;
  const oldIndex = from.cards.findIndex((c) => c.id === source.cardId);
  if (oldIndex < 0) return null;
  const card = from.cards[oldIndex]!;
  const without = from.cards.filter((c) => c.id !== card.id);
  const target = from === to ? without : to.cards;
  let index = target.length;
  if ("key" in landing) {
    const anchor = target.findIndex((c) => c.id === landing.key);
    if (anchor < 0) return null;
    index = anchor + (landing.position === "after" ? 1 : 0);
  }
  if (from === to && oldIndex === index) return null;
  const cards = [...target.slice(0, index), card, ...target.slice(index)];
  return {
    columns: columns.map((c) => c === to ? { ...c, cards } : c === from ? { ...c, cards: without } : c),
    move: { ...source, toColumnId, index },
  };
}

/** 宿主可以克隆数据或同时修改正文；只比较此操作涉及的列和业务顺序。 */
export function matchesMove(
  columns: readonly KanbanColumnData<KanbanItem>[], expected: readonly KanbanColumnData<KanbanItem>[], move: KanbanMove,
) {
  return [move.fromColumnId, move.toColumnId].every((id) => {
    const before = expected.find((c) => c.id === id)?.cards;
    const after = columns.find((c) => c.id === id)?.cards;
    return before && after && before.length === after.length && before.every((c, i) => c.id === after[i]?.id);
  });
}
