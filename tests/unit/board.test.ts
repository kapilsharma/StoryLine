import { describe, it, expect } from 'vitest'
import type { Board, Card, Character, ColumnGroup, Note, TimelineUnit } from '@shared/types'
import {
  visibleColumns as visibleColumnsOf,
  visibleRows,
  timelinePositions as timelinePositionsOf,
  resolveSpan,
  buildColumnLayout as buildColumnLayoutOf,
  buildRowLayout,
  buildBoardLayout as buildBoardLayoutOf,
  columnWindow,
  rowWindow,
  markerKey,
  reorderRowMember,
  reorderRowBlocks,
  orderedRowBlockKeys,
  withFilters,
  rowGroupNames,
  colGroupDepths,
  colGroupLevels,
  columnLevelItems,
  withAllRowGroups,
  withColumnsAtLevel
} from '@renderer/components/board/grid-utils'

// Chapter 1 holds S1–S2, S3 sits loose between the two chapters, Chapter 2 holds S4:
// the same board these tests described when a group was a string on each unit.
const colGroups: ColumnGroup[] = [
  { id: 'c1', type: 'colgroup', label: 'Chapter 1', order: 1 },
  { id: 'c2', type: 'colgroup', label: 'Chapter 2', order: 3 }
]
const timeline: TimelineUnit[] = [
  { id: 'ch1', label: 'S1', order: 1, parent: 'c1' },
  { id: 'ch2', label: 'S2', order: 2, parent: 'c1' },
  { id: 'ch3', label: 'S3', order: 2 },
  { id: 'ch4', label: 'S4', order: 1, parent: 'c2' }
]
// The layout functions take the groups last; every test here uses these ones.
const visibleColumns = (b: Board, t: TimelineUnit[]) => visibleColumnsOf(b, t, colGroups)
const timelinePositions = (t: TimelineUnit[]) => timelinePositionsOf(t, colGroups)
const buildColumnLayout = (b: Board, t: TimelineUnit[]) => buildColumnLayoutOf(b, t, colGroups)
const buildBoardLayout = (b: Board, c: Character[], t: TimelineUnit[], n: Note[]) =>
  buildBoardLayoutOf(b, c, t, n, colGroups)
const chars: Character[] = [
  { id: 'a', type: 'character', name: 'Aria', colour: '#111', group: 'Fae' },
  { id: 'b', type: 'character', name: 'Bob', colour: '#222', group: 'Human' },
  { id: 'c', type: 'character', name: 'Cyra', colour: '#333', group: 'Fae' }
]
const board = (over: Partial<Board>): Board => ({
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

describe('visibility + span (§8.2)', () => {
  const positions = timelinePositions(timeline)

  it('drops hidden columns but keeps order', () => {
    const vis = visibleColumns(board({ hiddenCols: ['ch3'] }), timeline)
    expect(vis.map((c) => c.id)).toEqual(['ch1', 'ch2', 'ch4'])
  })

  it('stretches a span across a hidden middle column', () => {
    const vis = visibleColumns(board({ hiddenCols: ['ch3'] }), timeline)
    const span = resolveSpan('ch2', 'ch4', vis, positions)
    expect(span).toEqual({ startIdx: 1, endIdx: 2 })
  })

  it('anchors to the next visible column when the start is hidden', () => {
    const vis = visibleColumns(board({ hiddenCols: ['ch2'] }), timeline)
    const span = resolveSpan('ch2', 'ch4', vis, positions)
    expect(span && vis[span.startIdx].id).toBe('ch3')
  })

  it('returns null when the whole span is hidden', () => {
    const vis = visibleColumns(board({ hiddenCols: ['ch2'] }), timeline)
    expect(resolveSpan('ch2', 'ch2', vis, positions)).toBeNull()
  })

  it('orders rows by rowOrder then name, minus hidden', () => {
    const rows = visibleRows(board({ rowOrder: ['c', 'a'], hiddenRows: ['a'] }), chars)
    expect(rows.map((r) => r.id)).toEqual(['c', 'b'])
  })
})

describe('column grouping', () => {
  it('builds spanning group headers when expanded', () => {
    const layout = buildColumnLayout(board({}), timeline)
    expect(layout.slots).toHaveLength(4)
    expect(layout.depth).toBe(1)
    expect(layout.headersByDepth[0][0]).toMatchObject({ node: { label: 'Chapter 1' }, startIndex: 0, span: 2 })
    expect(layout.headersByDepth[0][1]).toMatchObject({ node: { label: 'Chapter 2' }, startIndex: 3 })
  })

  it('collapses a group into one slot', () => {
    const layout = buildColumnLayout(board({ collapsedColGroups: ['c1'] }), timeline)
    expect(layout.slots).toHaveLength(3)
    expect(layout.slots[0].kind).toBe('colGroup')
    expect(layout.slotOfUnit.get('ch1')).toBe(0)
    expect(layout.slotOfUnit.get('ch2')).toBe(0)
    expect(layout.slotOfUnit.get('ch3')).toBe(1)
  })
})

describe('row grouping', () => {
  it('gathers all members of a group together', () => {
    const layout = buildRowLayout(board({}), chars)
    // groupHeader Fae, row a, row c, groupHeader Human, row b
    expect(layout.lines[0].kind).toBe('groupHeader')
    expect(layout.lineOfChar.get('a')).toBe(1)
    expect(layout.lineOfChar.get('c')).toBe(2)
    expect(layout.lineOfChar.get('b')).toBe(4)
  })

  it('collapses a group into a single groupRow', () => {
    const layout = buildRowLayout(board({ collapsedRowGroups: ['Fae'] }), chars)
    expect(layout.lines[0].kind).toBe('groupRow')
    expect(layout.lineOfChar.get('a')).toBe(0)
    expect(layout.lineOfChar.get('c')).toBe(0)
  })
})

describe('custom row + group sorting (issue #2)', () => {
  it('orders members within a group by rowOrder', () => {
    // default (name): Aria(a) before Cyra(c)
    const def = buildRowLayout(board({}), chars)
    expect(def.lineOfChar.get('a')! < def.lineOfChar.get('c')!).toBe(true)
    // rowOrder flips them
    const custom = buildRowLayout(board({ rowOrder: ['c', 'a'] }), chars)
    expect(custom.lineOfChar.get('c')! < custom.lineOfChar.get('a')!).toBe(true)
  })

  it('orders top-level blocks by rowGroupOrder', () => {
    const def = buildRowLayout(board({}), chars)
    expect(def.lines[0]).toMatchObject({ kind: 'groupHeader', group: 'Fae' })
    const custom = buildRowLayout(board({ rowGroupOrder: ['Human', 'Fae'] }), chars)
    expect(custom.lines[0]).toMatchObject({ kind: 'groupHeader', group: 'Human' })
  })

  it('lists ordered block keys', () => {
    expect(orderedRowBlockKeys(board({}), chars)).toEqual(['Fae', 'Human'])
  })

  it('reorderRowMember moves a member before its target within the group', () => {
    const next = reorderRowMember(board({}), chars, 'c', 'a')
    expect(next.indexOf('c')).toBeLessThan(next.indexOf('a'))
  })

  it('reorderRowMember is a no-op across groups', () => {
    const b = board({ rowOrder: ['x'] })
    expect(reorderRowMember(b, chars, 'a', 'b')).toEqual(['x'])
  })

  it('reorderRowBlocks reorders the block sequence', () => {
    expect(reorderRowBlocks(board({}), chars, 'Human', 'Fae')).toEqual(['Human', 'Fae'])
  })
})

describe('plot rows (#119)', () => {
  // A plot row and a character row, both ungrouped, plus the grouped `chars`.
  const withPlot: Character[] = [
    { id: 'p', type: 'character', name: 'Transformation', colour: '#999', rowKind: 'plot' },
    ...chars
  ]

  it('sorts plot rows above character rows, whatever the block order', () => {
    const layout = buildRowLayout(board({ rowGroupOrder: ['Fae', 'Human', 'p'] }), withPlot)
    // The plot row wins line 0 even though its block key is last in rowGroupOrder.
    expect(layout.lineOfChar.get('p')).toBe(0)
    expect(layout.lineOfChar.get('p')!).toBeLessThan(layout.lineOfChar.get('a')!)
    expect(layout.lineOfChar.get('p')!).toBeLessThan(layout.lineOfChar.get('b')!)
  })

  it('hidePlotRows drops only the plot rows', () => {
    const vis = visibleRows(board({ hidePlotRows: true }), withPlot)
    expect(vis.map((c) => c.id)).not.toContain('p')
    expect(vis.map((c) => c.id)).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })

  it('hideCharacterRows drops only the character rows', () => {
    const vis = visibleRows(board({ hideCharacterRows: true }), withPlot)
    expect(vis.map((c) => c.id)).toEqual(['p'])
  })

  it('hiding both kinds leaves an empty board', () => {
    const vis = visibleRows(board({ hidePlotRows: true, hideCharacterRows: true }), withPlot)
    expect(vis).toEqual([])
  })
})

describe('card placement + markers', () => {
  const notes: Note[] = [{ id: 'n1', uid: 'n_1111', title: 'Hunt', body: '' }]
  const card = { id: 'card1', noteUid: 'n_1111', rowId: 'a', colStart: 'ch3', colEnd: 'ch3' }

  it('renders a full card when nothing is collapsed', () => {
    const layout = buildBoardLayout(board({ cards: [card] }), chars, timeline, notes)
    expect(layout.fullCards).toHaveLength(1)
    expect(layout.markers.size).toBe(0)
  })

  it('shows a marker (no full card) when the row group is collapsed', () => {
    const layout = buildBoardLayout(
      board({ cards: [card], collapsedRowGroups: ['Fae'] }),
      chars,
      timeline,
      notes
    )
    expect(layout.fullCards).toHaveLength(0)
    const line = layout.rows.lineOfChar.get('a')!
    const slot = layout.cols.slotOfUnit.get('ch3')!
    expect(layout.markers.get(markerKey(line, slot))).toBe(1)
  })

  it('shows a marker when the column group is collapsed', () => {
    const card2 = { id: 'card2', noteUid: 'n_1111', rowId: 'b', colStart: 'ch1', colEnd: 'ch1' }
    const layout = buildBoardLayout(
      board({ cards: [card2], collapsedColGroups: ['c1'] }),
      chars,
      timeline,
      notes
    )
    expect(layout.fullCards).toHaveLength(0)
    const line = layout.rows.lineOfChar.get('b')!
    expect(layout.markers.get(markerKey(line, 0))).toBe(1)
  })

  // The span → visible-column resolution is a binary-search slice (#132); these
  // pin the edges that a scan handled implicitly.
  it('spans every slot for a full-width card and attaches its note', () => {
    const wide = { id: 'w', noteUid: 'n_1111', rowId: 'a', colStart: 'ch1', colEnd: 'ch4' }
    const layout = buildBoardLayout(board({ cards: [wide] }), chars, timeline, notes)
    const [pc] = layout.fullCards
    expect([pc.startSlot, pc.endSlot]).toEqual([0, 3])
    expect(pc.note?.title).toBe('Hunt')
  })

  it('resolves a span given end-before-start the same as start-before-end', () => {
    const rev = { id: 'r', noteUid: 'n_1111', rowId: 'a', colStart: 'ch4', colEnd: 'ch1' }
    const layout = buildBoardLayout(board({ cards: [rev] }), chars, timeline, notes)
    const [pc] = layout.fullCards
    expect([pc.startSlot, pc.endSlot]).toEqual([0, 3])
  })

  it('stretches a span across a hidden interior column', () => {
    const wide = { id: 'w', noteUid: 'n_1111', rowId: 'a', colStart: 'ch1', colEnd: 'ch3' }
    const layout = buildBoardLayout(board({ cards: [wide], hiddenCols: ['ch2'] }), chars, timeline, notes)
    const [pc] = layout.fullCards
    // ch2 is gone, so the visible slots are ch1 (0) and ch3 (1).
    expect([pc.startSlot, pc.endSlot]).toEqual([0, 1])
  })
})

describe('lone cards in collapsed cells (#161)', () => {
  const notes: Note[] = [{ id: 'n1', uid: 'n_1111', title: 'Hunt', body: '' }]
  const at = (id: string, rowId: string, colStart: string, colEnd = colStart): Card => ({
    id,
    noteUid: 'n_1111',
    rowId,
    colStart,
    colEnd
  })
  const runs = (l: { loneCards: { card: Card; startSlot: number; endSlot: number }[] }) =>
    l.loneCards.map((pc) => [pc.card.id, pc.startSlot, pc.endSlot])

  it('shows the only card in a collapsed row cell, in its own row colour', () => {
    const layout = buildBoardLayout(
      board({ cards: [at('x', 'c', 'ch3')], collapsedRowGroups: ['Fae'] }),
      chars,
      timeline,
      notes
    )
    expect(layout.fullCards).toHaveLength(0)
    expect(runs(layout)).toEqual([['x', 2, 2]])
    expect(layout.loneCards[0]).toMatchObject({ colour: '#333', lineIndex: 0, note: { title: 'Hunt' } })
  })

  it('shows the only card in a collapsed column cell', () => {
    const layout = buildBoardLayout(
      board({ cards: [at('x', 'b', 'ch2')], collapsedColGroups: ['c1'] }),
      chars,
      timeline,
      notes
    )
    expect(runs(layout)).toEqual([['x', 0, 0]])
  })

  it('keeps the count, and no card, when a cell holds two', () => {
    const layout = buildBoardLayout(
      board({ cards: [at('x', 'b', 'ch1'), at('y', 'b', 'ch2')], collapsedColGroups: ['c1'] }),
      chars,
      timeline,
      notes
    )
    expect(layout.loneCards).toEqual([])
    expect(layout.markers.get(markerKey(layout.rows.lineOfChar.get('b')!, 0))).toBe(2)
  })

  it('counts a spanning card in every collapsed cell and splits it where it shares one', () => {
    // Fae collapsed: Aria's card fills S1–S4 (slots 0–3); Cyra's sits on S3.
    const layout = buildBoardLayout(
      board({ cards: [at('wide', 'a', 'ch1', 'ch4'), at('y', 'c', 'ch3')], collapsedRowGroups: ['Fae'] }),
      chars,
      timeline,
      notes
    )
    const counts = [0, 1, 2, 3].map((s) => layout.markers.get(markerKey(0, s)))
    expect(counts).toEqual([1, 1, 2, 1])
    expect(runs(layout)).toEqual([
      ['wide', 0, 1],
      ['wide', 3, 3]
    ])
  })

  it('on an open row, summarises only the collapsed columns a card crosses', () => {
    // Chapter 2 collapsed: S3 is slot 2 (open), Chapter 2 is slot 3.
    const layout = buildBoardLayout(
      board({ cards: [at('x', 'b', 'ch3', 'ch4')], collapsedColGroups: ['c2'] }),
      chars,
      timeline,
      notes
    )
    const line = layout.rows.lineOfChar.get('b')!
    expect(layout.markers.get(markerKey(line, 2))).toBeUndefined()
    expect(layout.markers.get(markerKey(line, 3))).toBe(1)
    expect(runs(layout)).toEqual([['x', 3, 3]])
  })
})

/**
 * Stacking overlapping cards in one cell (Issue #66).
 *
 * The invariant that matters: two cards whose column spans overlap on the same
 * row must never share a stack level, and a board that never overlaps must keep
 * every card on level 0 so it looks exactly as it did before.
 */
describe('card stacking (#66)', () => {
  const note: Note[] = [{ id: 'n1', uid: 'n_1111', title: 'X', body: '' }]
  const at = (id: string, rowId: string, colStart: string, colEnd = colStart) => ({
    id,
    noteUid: 'n_1111',
    rowId,
    colStart,
    colEnd
  })

  it('keeps a single card on level 0 and records no depth', () => {
    const layout = buildBoardLayout(board({ cards: [at('c1', 'a', 'ch3')] }), chars, timeline, note)
    expect(layout.fullCards[0].stackIndex).toBe(0)
    expect(layout.stackDepth.size).toBe(0)
  })

  it('keeps non-overlapping cards on the same row at level 0', () => {
    const layout = buildBoardLayout(
      board({ cards: [at('c1', 'a', 'ch1'), at('c2', 'a', 'ch3')] }),
      chars,
      timeline,
      note
    )
    expect(layout.fullCards.map((c) => c.stackIndex)).toEqual([0, 0])
    expect(layout.stackDepth.size).toBe(0)
  })

  it('stacks two cards that share a cell', () => {
    const layout = buildBoardLayout(
      board({ cards: [at('c1', 'a', 'ch3'), at('c2', 'a', 'ch3')] }),
      chars,
      timeline,
      note
    )
    const levels = layout.fullCards.map((c) => c.stackIndex).sort()
    expect(levels).toEqual([0, 1])
    const line = layout.rows.lineOfChar.get('a')!
    expect(layout.stackDepth.get(line)).toBe(2)
  })

  it('stacks a spanning card above one it overlaps', () => {
    const layout = buildBoardLayout(
      board({ cards: [at('span', 'a', 'ch1', 'ch4'), at('single', 'a', 'ch3')] }),
      chars,
      timeline,
      note
    )
    const byId = new Map(layout.fullCards.map((c) => [c.card.id, c.stackIndex]))
    expect(byId.get('span')).not.toBe(byId.get('single'))
  })

  it('reuses a level once the earlier card has ended', () => {
    // ch1–ch1, ch1–ch1 (forces level 1), then ch4 which clears both.
    const layout = buildBoardLayout(
      board({ cards: [at('c1', 'a', 'ch1'), at('c2', 'a', 'ch1'), at('c3', 'a', 'ch4')] }),
      chars,
      timeline,
      note
    )
    const byId = new Map(layout.fullCards.map((c) => [c.card.id, c.stackIndex]))
    expect(byId.get('c3')).toBe(0)
    expect(layout.stackDepth.get(layout.rows.lineOfChar.get('a')!)).toBe(2)
  })

  it('counts stack levels per row, not across the board', () => {
    const layout = buildBoardLayout(
      board({ cards: [at('c1', 'a', 'ch3'), at('c2', 'a', 'ch3'), at('c3', 'b', 'ch3')] }),
      chars,
      timeline,
      note
    )
    const lineA = layout.rows.lineOfChar.get('a')!
    const lineB = layout.rows.lineOfChar.get('b')!
    expect(layout.stackDepth.get(lineA)).toBe(2)
    expect(layout.stackDepth.get(lineB)).toBeUndefined()
    expect(layout.fullCards.find((c) => c.card.id === 'c3')!.stackIndex).toBe(0)
  })

  it('stacks three cards in the same cell onto three levels', () => {
    const layout = buildBoardLayout(
      board({ cards: [at('c1', 'a', 'ch3'), at('c2', 'a', 'ch3'), at('c3', 'a', 'ch3')] }),
      chars,
      timeline,
      note
    )
    expect(layout.fullCards.map((c) => c.stackIndex).sort()).toEqual([0, 1, 2])
    expect(layout.stackDepth.get(layout.rows.lineOfChar.get('a')!)).toBe(3)
  })
})

describe('withFilters (#140)', () => {
  const note: Note[] = [{ id: 'n1', uid: 'n_1111', title: 'X', body: '' }]
  const at = (id: string, rowId: string, colStart: string, colEnd = colStart): Card => ({
    id,
    noteUid: 'n_1111',
    rowId,
    colStart,
    colEnd
  })

  it('returns the same board object when nothing is filtered', () => {
    const b = board({})
    expect(withFilters(b, new Set(), new Set())).toBe(b)
  })

  it('folds excluded rows and columns into hiddenRows / hiddenCols', () => {
    const b = board({ hiddenRows: ['a'], hiddenCols: ['ch1'] })
    const filtered = withFilters(b, new Set(['b']), new Set(['ch3']))
    // Pre-hidden entries are kept, filtered ones added, and no id is duplicated.
    expect(filtered.hiddenRows.sort()).toEqual(['a', 'b'])
    expect(filtered.hiddenCols.sort()).toEqual(['ch1', 'ch3'])
    expect(b.hiddenRows).toEqual(['a']) // original untouched
  })

  it("doesn't duplicate an id already hidden on the board", () => {
    const b = board({ hiddenRows: ['a'] })
    expect(withFilters(b, new Set(['a']), new Set()).hiddenRows).toEqual(['a'])
  })

  it('a filtered row drops out of the layout like a hidden one', () => {
    const b = board({ cards: [at('c1', 'a', 'ch3'), at('c2', 'b', 'ch3')] })
    const layout = buildBoardLayout(withFilters(b, new Set(['b']), new Set()), chars, timeline, note)
    expect(visibleRows(withFilters(b, new Set(['b']), new Set()), chars).map((c) => c.id)).toEqual(['a', 'c'])
    expect(layout.fullCards.map((c) => c.card.id)).toEqual(['c1'])
  })

  it('a card whose whole span is filtered away disappears', () => {
    const b = board({ cards: [at('c1', 'a', 'ch3')] })
    const layout = buildBoardLayout(withFilters(b, new Set(), new Set(['ch3'])), chars, timeline, note)
    expect(layout.fullCards).toHaveLength(0)
  })
})

describe('columnWindow (#150 horizontal virtualization)', () => {
  // headerW 200, colW 100, 50 columns, overscan 2.
  const win = (scrollLeft: number, clientWidth: number): { first: number; last: number } =>
    columnWindow(scrollLeft, clientWidth, 200, 100, 50, 2)

  it('renders every column when the container is unmeasured (first mount / jsdom)', () => {
    expect(win(0, 0)).toEqual({ first: 0, last: 49 })
  })

  it('at the left edge starts at 0 and covers the viewport plus overscan', () => {
    // 800px of columns after the 200px header = 8 columns, + 2 overscan.
    expect(win(0, 1000)).toEqual({ first: 0, last: 10 })
  })

  it('scrolled right, returns a middle slice offset by the scroll', () => {
    // Columns start at x=200; scrollLeft 1200 → (1200-200)/100 = col 10, minus
    // overscan = 8; right edge (1200+1000-200)/100 = 20, plus overscan = 22.
    expect(win(1200, 1000)).toEqual({ first: 8, last: 22 })
  })

  it('clamps the last column to the end of the board', () => {
    expect(win(100000, 1000).last).toBe(49)
  })

  it('never returns last before first', () => {
    const w = win(100000, 1000)
    expect(w.last).toBeGreaterThanOrEqual(w.first)
  })

  it('is empty-safe when there are no columns', () => {
    expect(columnWindow(0, 1000, 200, 100, 0, 2)).toEqual({ first: 0, last: -1 })
  })
})

describe('rowWindow (#157 vertical virtualization)', () => {
  // A 44px sticky header band, then 10 rows of 50px each → tops = [44,94,...,544].
  const tops = Array.from({ length: 11 }, (_, i) => 44 + i * 50)
  const win = (scrollTop: number, clientHeight: number): { first: number; last: number } =>
    rowWindow(scrollTop, clientHeight, tops, 1)

  it('renders every line when the container is unmeasured', () => {
    expect(win(0, 0)).toEqual({ first: 0, last: 9 })
  })

  it('at the top, covers the viewport plus one overscan line', () => {
    // 150px tall viewport starting below the 44px header → ~3 rows, +1 overscan.
    expect(win(0, 150)).toEqual({ first: 0, last: 3 })
  })

  it('scrolled down, returns a middle slice', () => {
    // Viewport [244,394] covers rows 4–6 (each 50px); ±1 overscan → {3,7}.
    expect(win(244, 150)).toEqual({ first: 3, last: 7 })
  })

  it('clamps to the last line at the bottom', () => {
    expect(win(100000, 150).last).toBe(9)
  })

  it('never returns last before first, and is empty-safe', () => {
    const w = win(100000, 150)
    expect(w.last).toBeGreaterThanOrEqual(w.first)
    expect(rowWindow(0, 150, [44], 1)).toEqual({ first: 0, last: -1 })
  })
})

describe('collapse / expand all groups (#164)', () => {
  // Novel holds two chapters (c1, c2); a scene can also sit loose under it.
  const nested: ColumnGroup[] = [
    { id: 'novel', type: 'colgroup', label: 'Book', order: 1 },
    { ...colGroups[0], parent: 'novel' },
    { ...colGroups[1], parent: 'novel' }
  ]
  const levels3 = { timelineLabel: 'Scene', timelineLevelLabels: ['Novel', 'Chapter', 'Scene'] }

  it('lists each row group once, members only', () => {
    expect(rowGroupNames(board({}), chars).sort()).toEqual(['Fae', 'Human'])
    expect(rowGroupNames(board({ members: ['b'] }), chars)).toEqual(['Human'])
  })

  it('collapses and expands every row group, leaving columns alone', () => {
    const shut = withAllRowGroups(board({ collapsedColGroups: ['c2'] }), chars, true)
    expect(shut.collapsedRowGroups.sort()).toEqual(['Fae', 'Human'])
    expect(shut.collapsedColGroups).toEqual(['c2'])
    expect(buildRowLayout(shut, chars).lines.every((l) => l.kind === 'groupRow')).toBe(true)
    expect(withAllRowGroups(shut, chars, false).collapsedRowGroups).toEqual([])
  })

  it('knows each column group’s depth and which depths hold groups', () => {
    expect(Object.fromEntries(colGroupDepths(nested))).toEqual({ novel: 0, c1: 1, c2: 1 })
    expect(colGroupLevels(nested)).toEqual([0, 1])
    expect(colGroupLevels([])).toEqual([])
  })

  it('shows the columns at one level: that level folded, every other open', () => {
    // Novel had been folded; "Collapse Chapter" opens it so the chapters show.
    const b = board({ collapsedColGroups: ['novel'], collapsedRowGroups: ['Fae'] })
    const chapters = withColumnsAtLevel(b, nested, 1)
    expect(chapters.collapsedColGroups.sort()).toEqual(['c1', 'c2'])
    expect(chapters.collapsedRowGroups).toEqual(['Fae'])
    const layout = buildColumnLayout(chapters, timeline)
    // S3 is loose at the top level here, so it stays a column between chapters.
    expect(layout.slots.map((sl) => sl.kind)).toEqual(['colGroup', 'col', 'colGroup'])

    expect(withColumnsAtLevel(chapters, nested, 0).collapsedColGroups).toEqual(['novel'])
    expect(withColumnsAtLevel(chapters, nested, null).collapsedColGroups).toEqual([])
  })

  it('names each level from the project, never the leaf level', () => {
    expect(columnLevelItems(levels3, [0, 1])).toEqual([
      { depth: 0, label: 'Collapse Novel' },
      { depth: 1, label: 'Collapse Chapter' }
    ])
  })

  it('falls back to plain wording where the levels don’t name a group', () => {
    const single = { timelineLabel: 'Chapter' }
    expect(columnLevelItems(single, [0])).toEqual([{ depth: 0, label: 'Collapse all columns' }])
    expect(columnLevelItems(single, [0, 1]).map((i) => i.label)).toEqual([
      'Collapse level 1',
      'Collapse level 2'
    ])
    // Two named levels but groups three deep: the third borrows nothing.
    expect(columnLevelItems(levels3, [0, 1, 2]).map((i) => i.label)).toEqual([
      'Collapse Novel',
      'Collapse Chapter',
      'Collapse level 3'
    ])
  })
})
