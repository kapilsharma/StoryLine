import { describe, it, expect } from 'vitest'
import type { Board, ColumnGroup, TimelineUnit } from '@shared/types'
import {
  buildColumnTree,
  canMoveUnder,
  collectColumnDescendants,
  nextOrder,
  orderedLeaves,
  planDrop,
  planMove,
  planReorder,
  type ColumnRef
} from '@shared/columns'
import { buildBoardLayout, buildColumnLayout } from '@renderer/components/board/grid-utils'

const g = (id: string, order: number, parent?: string, label = id): ColumnGroup => ({
  id,
  type: 'colgroup',
  label,
  order,
  ...(parent ? { parent } : {})
})
const u = (id: string, order: number, parent?: string): TimelineUnit => ({
  id,
  label: id,
  order,
  ...(parent ? { parent } : {})
})
const unit = (id: string): ColumnRef => ({ kind: 'unit', id })
const node = (id: string): ColumnRef => ({ kind: 'node', id })

const board = (over: Partial<Board> = {}): Board => ({
  id: 'b',
  name: 'B',
  cards: [],
  hiddenRows: [],
  hiddenCols: [],
  presets: [],
  rowOrder: [],
  rowGroupOrder: [],
  colOrder: [],
  collapsedRowGroups: [],
  collapsedColGroups: [],
  zoom: 1,
  members: null,
  views: [],
  ...over
})

/**
 *   novel-1                 (group, top)
 *     part-a                (group)
 *       ch1, ch2            (columns)
 *     ch3                   (a column straight under the novel — ragged)
 *   ch4                     (column at top level)
 *   novel-2
 *     ch5
 */
const groups = [g('novel-1', 1), g('part-a', 1, 'novel-1'), g('novel-2', 3)]
const units = [u('ch1', 1, 'part-a'), u('ch2', 2, 'part-a'), u('ch3', 2, 'novel-1'), u('ch4', 2), u('ch5', 1, 'novel-2')]

describe('buildColumnTree', () => {
  it('orders siblings by `order`, groups and columns interleaved', () => {
    const tree = buildColumnTree(groups, units)
    expect(tree.childrenOf(null).map((i) => (i.kind === 'node' ? i.node.id : i.unit.id))).toEqual([
      'novel-1',
      'ch4',
      'novel-2'
    ])
    expect(tree.childrenOf('novel-1').map((i) => (i.kind === 'node' ? i.node.id : i.unit.id))).toEqual([
      'part-a',
      'ch3'
    ])
  })

  it('breaks an order tie with groups first, then by label', () => {
    const tree = buildColumnTree([g('z', 1, undefined, 'Zed')], [u('a', 1), u('b', 1)])
    expect(tree.childrenOf(null).map((i) => (i.kind === 'node' ? i.node.id : i.unit.id))).toEqual(['z', 'a', 'b'])
  })

  it('falls back to the id when order, kind and label all tie, so the sequence is stable', () => {
    const twin = (id: string): TimelineUnit => ({ id, label: 'Same', order: 1 })
    const order = (list: TimelineUnit[]): string[] =>
      buildColumnTree([], list)
        .childrenOf(null)
        .map((i) => (i.kind === 'unit' ? i.unit.id : i.node.id))
    // Whichever way they arrive, they come out the same way.
    expect(order([twin('b'), twin('a')])).toEqual(['a', 'b'])
    expect(order([twin('a'), twin('b')])).toEqual(['a', 'b'])
  })

  it('reports depth from the top', () => {
    const tree = buildColumnTree(groups, units)
    expect(tree.depthOf(node('novel-1'))).toBe(0)
    expect(tree.depthOf(node('part-a'))).toBe(1)
    expect(tree.depthOf(unit('ch1'))).toBe(2)
    expect(tree.depthOf(unit('ch3'))).toBe(1) // ragged: a column beside a group
    expect(tree.depthOf(unit('ch4'))).toBe(0)
  })

  it('lifts a column whose parent no longer exists to the top level', () => {
    const tree = buildColumnTree([], [u('lost', 1, 'deleted-group')])
    expect(tree.parentOf(unit('lost'))).toBeNull()
    expect(tree.childrenOf(null)).toHaveLength(1)
  })

  it('breaks a cycle from a hand-edited file rather than looping or hiding anything', () => {
    const tree = buildColumnTree([g('a', 1, 'b'), g('b', 1, 'a')], [u('x', 1, 'a')])
    expect(tree.parentOf(node('a'))).toBeNull()
    expect(tree.parentOf(node('b'))).toBeNull()
    expect(orderedLeaves([g('a', 1, 'b'), g('b', 1, 'a')], [u('x', 1, 'a')]).map((x) => x.id)).toEqual(['x'])
  })

  it('treats a group that names itself as its parent as top level', () => {
    expect(buildColumnTree([g('a', 1, 'a')], []).parentOf(node('a'))).toBeNull()
  })

  it('keeps a group that merely sits under a cycle attached to something', () => {
    const tree = buildColumnTree([g('a', 1, 'b'), g('b', 1, 'a'), g('c', 1, 'a')], [])
    expect(tree.parentOf(node('c'))).toBe('a')
  })
})

describe('orderedLeaves', () => {
  it('is the depth-first walk — a group’s columns sit together wherever it sits', () => {
    expect(orderedLeaves(groups, units).map((x) => x.id)).toEqual(['ch1', 'ch2', 'ch3', 'ch4', 'ch5'])
  })

  it('is just the columns in order when there are no groups', () => {
    expect(orderedLeaves([], [u('b', 2), u('a', 1)]).map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('collectColumnDescendants', () => {
  it('lists everything under a group, depth-first, with how far down each sits', () => {
    const found = collectColumnDescendants(groups, units, 'novel-1').map((d) => [
      d.kind === 'node' ? d.node.id : d.unit.id,
      d.depth
    ])
    expect(found).toEqual([
      ['part-a', 1],
      ['ch1', 2],
      ['ch2', 2],
      ['ch3', 1]
    ])
  })

  it('is empty for a group with nothing in it', () => {
    expect(collectColumnDescendants([g('empty', 1)], [], 'empty')).toEqual([])
  })
})

describe('canMoveUnder / nextOrder', () => {
  const tree = buildColumnTree(groups, units)

  it('lets a column go under any group, or to the top', () => {
    expect(canMoveUnder(tree, unit('ch4'), 'part-a')).toBe(true)
    expect(canMoveUnder(tree, unit('ch1'), null)).toBe(true)
  })

  it('refuses a group going into itself or anything inside it', () => {
    expect(canMoveUnder(tree, node('novel-1'), 'novel-1')).toBe(false)
    expect(canMoveUnder(tree, node('novel-1'), 'part-a')).toBe(false)
    expect(canMoveUnder(tree, node('part-a'), 'novel-2')).toBe(true)
  })

  it('refuses a parent that does not exist', () => {
    expect(canMoveUnder(tree, unit('ch1'), 'nowhere')).toBe(false)
  })

  it('gives a new item the next free order under a parent', () => {
    expect(nextOrder(tree, 'part-a')).toBe(3)
    expect(nextOrder(tree, 'novel-2')).toBe(2)
    expect(nextOrder(buildColumnTree([], []), null)).toBe(1)
  })
})

describe('planReorder', () => {
  const tree = buildColumnTree(groups, units)

  it('renumbers siblings into the order given, changing only what moved', () => {
    const plan = planReorder(tree, 'part-a', [unit('ch2'), unit('ch1')])
    expect(plan).toEqual([
      { ref: unit('ch2'), parent: 'part-a', order: 1 },
      { ref: unit('ch1'), parent: 'part-a', order: 2 }
    ])
  })

  it('is a no-op when the order already matches', () => {
    expect(planReorder(tree, 'part-a', [unit('ch1'), unit('ch2')])).toEqual([])
  })

  it('keeps anything the list leaves out, after the named ones — a stale list drops nothing', () => {
    const plan = planReorder(tree, 'part-a', [unit('ch2')])
    expect(plan.map((p) => p.ref.id)).toEqual(['ch2', 'ch1'])
  })

  it('ignores ids that are not under that parent', () => {
    const plan = planReorder(tree, 'part-a', [unit('ch5'), unit('ch2'), unit('ch1')])
    expect(plan.map((p) => p.ref.id)).toEqual(['ch2', 'ch1'])
  })
})

describe('planMove', () => {
  const tree = buildColumnTree(groups, units)

  it('moves a column under a group, last by default, and closes the gap it left', () => {
    const plan = planMove(tree, unit('ch4'), 'part-a')!
    expect(plan.find((p) => p.ref.id === 'ch4')).toEqual({ ref: unit('ch4'), parent: 'part-a', order: 3 })
  })

  it('puts the item at the requested index among its new siblings', () => {
    const plan = planMove(tree, unit('ch4'), 'part-a', 0)!
    const orders = Object.fromEntries(plan.map((p) => [p.ref.id, p.order]))
    expect(orders).toMatchObject({ ch4: 1, ch1: 2, ch2: 3 })
  })

  it('renumbers the old parent too, so pulling one out of the middle leaves no gap', () => {
    const plan = planMove(tree, unit('ch1'), null)!
    // ch2 was 2nd under part-a; with ch1 gone it is 1st.
    expect(plan.find((p) => p.ref.id === 'ch2')).toEqual({ ref: unit('ch2'), parent: 'part-a', order: 1 })
  })

  it('moves a group with everything under it intact (only its own parent changes)', () => {
    const plan = planMove(tree, node('part-a'), 'novel-2')!
    expect(plan.find((p) => p.ref.id === 'part-a')?.parent).toBe('novel-2')
    expect(plan.some((p) => p.ref.id === 'ch1')).toBe(false)
  })

  it('returns null for a group moved into its own subtree, or an item that does not exist', () => {
    expect(planMove(tree, node('novel-1'), 'part-a')).toBeNull()
    expect(planMove(tree, unit('ghost'), null)).toBeNull()
  })

  it('clamps an out-of-range index to the ends', () => {
    expect(planMove(tree, unit('ch4'), 'part-a', 99)!.find((p) => p.ref.id === 'ch4')?.order).toBe(3)
    expect(planMove(tree, unit('ch4'), 'part-a', -5)!.find((p) => p.ref.id === 'ch4')?.order).toBe(1)
  })
})

describe('planDrop', () => {
  const tree = buildColumnTree(groups, units)

  it('drops before / after a row as a sibling of it', () => {
    expect(planDrop(tree, unit('ch4'), unit('ch2'), 'before')).toEqual({ parent: 'part-a', index: 1 })
    expect(planDrop(tree, unit('ch4'), unit('ch2'), 'after')).toEqual({ parent: 'part-a', index: 2 })
  })

  it('drops inside a group as its last child', () => {
    expect(planDrop(tree, unit('ch4'), node('novel-2'), 'inside')).toEqual({ parent: 'novel-2' })
  })

  it('refuses to drop inside a column, onto itself, or a group into its own subtree', () => {
    expect(planDrop(tree, unit('ch4'), unit('ch1'), 'inside')).toBeNull()
    expect(planDrop(tree, unit('ch1'), unit('ch1'), 'before')).toBeNull()
    expect(planDrop(tree, node('novel-1'), node('part-a'), 'inside')).toBeNull()
    expect(planDrop(tree, node('novel-1'), unit('ch1'), 'before')).toBeNull()
  })

  it('counts the index with the dragged item taken out', () => {
    // ch1 dragged to just after ch2 within the same parent: ch2 is then the only one left.
    expect(planDrop(tree, unit('ch1'), unit('ch2'), 'after')).toEqual({ parent: 'part-a', index: 1 })
  })
})

describe('column layout over a tree (Issue #104)', () => {
  it('is flat — no header rows at all — when there are no groups', () => {
    const layout = buildColumnLayout(board(), [u('a', 1), u('b', 2)], [])
    expect(layout.depth).toBe(0)
    expect(layout.headersByDepth).toEqual([])
    expect(layout.slots.map((s) => s.kind)).toEqual(['col', 'col'])
  })

  it('gives one header row per level in use, spanning what is under each group', () => {
    const layout = buildColumnLayout(board(), units, groups)
    expect(layout.depth).toBe(2)
    expect(layout.slots).toHaveLength(5)
    // Row 0: the two novels. novel-1 spans ch1–ch3, novel-2 sits over ch5.
    expect(layout.headersByDepth[0].map((h) => [h.node.id, h.startIndex, h.span])).toEqual([
      ['novel-1', 0, 3],
      ['novel-2', 4, 1]
    ])
    // Row 1: part-a over ch1–ch2 only — ch3 sits beside it with no part over it.
    expect(layout.headersByDepth[1].map((h) => [h.node.id, h.startIndex, h.span])).toEqual([
      ['part-a', 0, 2]
    ])
  })

  it('draws a ragged tree — a column beside a group, a column at the top — in tree order', () => {
    const layout = buildColumnLayout(board(), units, groups)
    expect(layout.slots.map((s) => (s.kind === 'col' ? s.unit.id : s.node.id))).toEqual([
      'ch1',
      'ch2',
      'ch3',
      'ch4',
      'ch5'
    ])
    expect(layout.slots.map((s) => (s.kind === 'col' ? s.depth : -1))).toEqual([2, 2, 1, 0, 1])
  })

  it('keeps two groups that share a label separate, because they are different entities', () => {
    const layout = buildColumnLayout(
      board(),
      [u('a', 1, 'x'), u('b', 1, 'y')],
      [g('x', 1, undefined, 'Part'), g('y', 2, undefined, 'Part')]
    )
    expect(layout.headersByDepth[0].map((h) => h.node.id)).toEqual(['x', 'y'])
  })

  it('collapses a group to one slot, and everything inside it with it', () => {
    const layout = buildColumnLayout(board({ collapsedColGroups: ['novel-1'] }), units, groups)
    expect(layout.slots.map((s) => s.kind)).toEqual(['colGroup', 'col', 'col'])
    // The nested part's header is gone with it: only the one collapsed header remains.
    expect(layout.depth).toBe(1)
    expect(layout.headersByDepth[0][0]).toMatchObject({ node: { id: 'novel-1' }, span: 1, collapsed: true })
    for (const id of ['ch1', 'ch2', 'ch3']) expect(layout.slotOfUnit.get(id)).toBe(0)
  })

  it('collapses an inner group without touching its parent', () => {
    const layout = buildColumnLayout(board({ collapsedColGroups: ['part-a'] }), units, groups)
    expect(layout.slots.map((s) => s.kind)).toEqual(['colGroup', 'col', 'col', 'col'])
    expect(layout.headersByDepth[0][0]).toMatchObject({ node: { id: 'novel-1' }, span: 2 })
  })

  it('drops a group whose columns are all hidden, instead of leaving an empty header', () => {
    const layout = buildColumnLayout(board({ hiddenCols: ['ch5'] }), units, groups)
    expect(layout.headersByDepth[0].map((h) => h.node.id)).toEqual(['novel-1'])
  })

  it('narrows a group’s span when some of its columns are hidden', () => {
    const layout = buildColumnLayout(board({ hiddenCols: ['ch2'] }), units, groups)
    expect(layout.headersByDepth[1][0]).toMatchObject({ node: { id: 'part-a' }, span: 1 })
  })

  it('spans a card across columns in different groups using the tree order', () => {
    const layout = buildBoardLayout(
      board({ cards: [{ id: 'c1', noteUid: 'n1', rowId: 'a', colStart: 'ch2', colEnd: 'ch4' }] }),
      [{ id: 'a', type: 'character', name: 'A', colour: '#111' }],
      units,
      [{ id: 'n', uid: 'n1', title: 'T', body: '' }],
      groups
    )
    expect(layout.fullCards[0]).toMatchObject({ startSlot: 1, endSlot: 3 })
  })

  it('shows a marker, not a card, where a card sits inside a collapsed group', () => {
    const layout = buildBoardLayout(
      board({
        collapsedColGroups: ['novel-1'],
        cards: [{ id: 'c1', noteUid: 'n1', rowId: 'a', colStart: 'ch1', colEnd: 'ch1' }]
      }),
      [{ id: 'a', type: 'character', name: 'A', colour: '#111' }],
      units,
      [{ id: 'n', uid: 'n1', title: 'T', body: '' }],
      groups
    )
    expect(layout.fullCards).toHaveLength(0)
    expect([...layout.markers.values()]).toEqual([1])
  })
})
